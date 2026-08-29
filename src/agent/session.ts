import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parsePrompt, type Prompt } from "./prompts";
import { detectHandoff } from "./handoff";
import { endAgentBuild } from "../mcp/buildScope";

export const AGENT_SESSION = "main";

/** One rendered block in the conversation. */
export type Block =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "text"; id: string; text: string;
      /** A question the agent asked in prose, lifted out so it can be
       *  answered by clicking rather than retyped. */
      prompt?: Prompt;
      /** A command this reply says needs a real terminal. */
      handoff?: string;
    }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "done" | "error"; result?: string }
  | { kind: "notice"; id: string; text: string }
  | { kind: "result"; id: string; costUsd?: number; durationMs?: number; error?: boolean };

interface SessionInfo {
  model?: string;
  cwd?: string;
  mcpServers?: Array<{ name: string; status: string }>;
  tools?: string[];
  /** Slash commands the agent itself advertises, so the menu reflects what
   *  this agent actually supports rather than a list hardcoded here. */
  slashCommands?: string[];
}

interface AgentStore {
  running: boolean;
  /** The conversation id, owned by the app so the terminal can resume it. */
  sessionId: string;
  /** Whether that conversation exists yet. Resuming one that was never
   *  started fails, so the terminal has to be told which to use. */
  hasConversation: boolean;
  /** Models the agent said it accepts, learned from a /model reply. */
  models: string[];
  busy: boolean;
  blocks: Block[];
  info: SessionInfo;
  error: string | null;

  start: (cwd: string) => Promise<void>;
  /** Restart against the same conversation, picking up anything that
   *  happened to it elsewhere — in the terminal, for instance. */
  reload: (cwd: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
}

let seq = 0;
const nextId = () => `b${seq++}`;
/** The slash command awaiting a reply, so any choices in it can be labelled. */
let pendingCommand: string | null = null;

/**
 * Ids of blocks built from streaming deltas, keyed by the content-block index
 * the agent used.
 *
 * The complete `assistant` message arrives after the deltas that composed it,
 * so without this the same text would render twice. Streamed blocks are
 * claimed here and the final message reconciles with them instead of
 * appending.
 */
let streamed = new Map<number, string>();

/**
 * Commands offered before the agent has introduced itself.
 *
 * The real list arrives on the session's init event — but that only fires
 * after the first message, so without a fallback the menu is empty exactly
 * when someone is most likely to reach for it. Replaced wholesale once the
 * agent reports what it actually supports.
 */
const FALLBACK_SLASH_COMMANDS = [
  "clear", "compact", "config", "context", "cost", "doctor", "help",
  "init", "login", "logout", "mcp", "memory", "model", "permissions",
  "review", "status",
];

/** Tool names are namespaced; show the part a person cares about. */
export function prettyToolName(name: string): string {
  const parts = name.split("__");
  return (parts[parts.length - 1] || name).replace(/_/g, " ");
}

export const useAgent = create<AgentStore>((set, get) => {
  /**
   * Fold one agent event into the conversation.
   *
   * The stream carries far more than a chat: hook chatter, rate-limit notices,
   * partial deltas. Only what a person would want to see is rendered, and
   * anything unrecognised is ignored rather than shown as noise.
   */
  const apply = (event: Record<string, any>) => {
    const type = event.type as string;

    // --- token-level streaming ------------------------------------------
    if (type === "stream_event") {
      const ev = event.event ?? {};

      if (ev.type === "message_start") {
        streamed = new Map();
        return;
      }

      if (ev.type === "content_block_start") {
        const block = ev.content_block ?? {};
        // Tool calls are handled from the complete message: their arguments
        // arrive as partial JSON, which is not worth rendering half-parsed.
        if (block.type !== "text" && block.type !== "thinking") return;
        const id = nextId();
        streamed.set(ev.index, id);
        set((s) => ({
          blocks: [...s.blocks, {
            kind: block.type === "thinking" ? "thinking" : "text",
            id,
            text: block.text ?? block.thinking ?? "",
          }],
        }));
        return;
      }

      if (ev.type === "content_block_delta") {
        const id = streamed.get(ev.index);
        if (!id) return;
        const delta = ev.delta ?? {};
        const chunk: string = delta.text ?? delta.thinking ?? "";
        if (!chunk) return;
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === id && (b.kind === "text" || b.kind === "thinking")
              ? { ...b, text: b.text + chunk }
              : b,
          ),
        }));
        return;
      }

      return;
    }

    if (type === "system" && event.subtype === "init") {
      set({
        info: {
          model: event.model,
          cwd: event.cwd,
          mcpServers: event.mcp_servers,
          tools: event.tools,
          slashCommands: event.slash_commands?.length
            ? event.slash_commands
            : FALLBACK_SLASH_COMMANDS,
        },
      });
      return;
    }

    if (type === "assistant") {
      const content = event.message?.content ?? [];
      const added: Block[] = [];
      // Reconcile with whatever streamed: the completed text replaces the
      // accumulated chunks, so a dropped delta cannot leave a gap.
      const claimed = [...streamed.values()];
      streamed = new Map();
      let claimIndex = 0;

      for (const c of content) {
        if ((c.type === "text" || c.type === "thinking") && claimed[claimIndex]) {
          // Already on screen from the stream; correct it in place.
          const id = claimed[claimIndex++];
          const finalText = c.type === "thinking" ? c.thinking : c.text;
          const parsed = c.type === "text" ? parsePrompt(finalText ?? "") : null;
          const prompt = parsed
            ? { ...parsed, command: pendingCommand ?? undefined }
            : undefined;
          if (prompt && pendingCommand === "model") {
            set({ models: prompt.options.map((o) => o.value) });
          }
          const handoff = c.type === "text" ? detectHandoff(finalText ?? "") : null;
          set((st) => ({
            blocks: st.blocks.map((b) =>
              b.id === id && (b.kind === "text" || b.kind === "thinking")
                ? {
                    ...b, text: finalText ?? b.text,
                    ...(prompt ? { prompt } : {}),
                    ...(handoff ? { handoff } : {}),
                  }
                : b,
            ),
          }));
          continue;
        }

        if (c.type === "text" && c.text?.trim()) {
          const parsed = parsePrompt(c.text);
          const prompt = parsed
            ? { ...parsed, command: pendingCommand ?? undefined }
            : undefined;
          if (prompt && pendingCommand === "model") {
            set({ models: prompt.options.map((o) => o.value) });
          }
          // The model label comes from the one-off init event, so a later
          // /model change would leave it stale. Take the confirmation as the
          // authority rather than assuming the switch worked.
          const switched = /Set model to\s*`?([^`\n(]+)`?/i.exec(c.text);
          if (switched && pendingCommand === "model") {
            set((st) => ({ info: { ...st.info, model: switched[1].trim() } }));
          }
          const handoff = detectHandoff(c.text);
          added.push({
            kind: "text", id: nextId(), text: c.text,
            ...(prompt ? { prompt } : {}),
            ...(handoff ? { handoff } : {}),
          });
        } else if (c.type === "thinking" && c.thinking?.trim()) {
          added.push({ kind: "thinking", id: nextId(), text: c.thinking });
        } else if (c.type === "tool_use") {
          added.push({
            kind: "tool", id: c.id ?? nextId(),
            name: c.name, input: c.input, status: "running",
          });
        }
      }
      if (added.length) set((s) => ({ blocks: [...s.blocks, ...added] }));
      return;
    }

    if (type === "user") {
      // Tool results come back as user-role messages; attach them to their call.
      const content = event.message?.content ?? [];
      for (const c of content) {
        if (c.type !== "tool_result") continue;
        const text = Array.isArray(c.content)
          ? c.content.map((p: any) => p.text ?? `[${p.type}]`).join("\n")
          : String(c.content ?? "");
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.kind === "tool" && b.id === c.tool_use_id
              ? { ...b, status: c.is_error ? "error" : "done", result: text }
              : b,
          ),
        }));
      }
      return;
    }

    if (type === "result") {
      // The turn is over, so whatever it built is one finished thing.
      endAgentBuild();
      set((s) => ({
        busy: false,
        blocks: [...s.blocks, {
          kind: "result", id: nextId(),
          costUsd: event.total_cost_usd,
          durationMs: event.duration_ms,
          error: !!event.is_error,
        }],
      }));
      return;
    }

    if (type === "rate_limit_event") {
      // Only surface a limit that actually stops work. "allowed" and
      // "allowed_warning" are routine and were pure noise in the transcript.
      const status = event.rate_limit_info?.status;
      if (status && !String(status).startsWith("allowed")) {
        set((s) => ({
          blocks: [...s.blocks, {
            kind: "notice", id: nextId(), text: `Rate limited: ${status}`,
          }],
        }));
      }
    }
  };

  let attached = false;
  /** Whether this conversation exists yet; a resume of nothing is an error. */
  let started = false;

  return {
    running: false,
    // Deliberately empty: the id is restored with the document, or minted on
    // first use. Generating one here would mint a fresh id on every page load
    // — including every hot reload — and the handoff would then try to resume
    // a conversation that was never created.
    sessionId: "",
    hasConversation: false,
    models: [],
    busy: false,
    blocks: [],
    info: { slashCommands: FALLBACK_SLASH_COMMANDS },
    error: null,

    start: async (cwd) => {
      if (!attached) {
        attached = true;
        await listen<{ id: string; event: Record<string, any> }>("agent:event", (e) => {
          if (e.payload.id === AGENT_SESSION) apply(e.payload.event);
        });
        await listen<{ id: string }>("agent:closed", (e) => {
          if (e.payload.id === AGENT_SESSION) set({ running: false, busy: false });
        });
      }
      // Mint an id the first time one is needed, then keep it.
      let sessionId = get().sessionId;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        set({ sessionId });
      }
      try {
        await invoke("agent_start", {
          id: AGENT_SESSION,
          cwd,
          sessionId,
          resume: started,
        });
        started = true;
        set({ running: true, error: null });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err), running: false });
      }
    },

    reload: async (cwd) => {
      await invoke("agent_stop", { id: AGENT_SESSION }).catch(() => {});
      set({ running: false });
      await get().start(cwd);
    },

    send: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().busy) return;
      const slash = /^\/(\w[\w-]*)/.exec(trimmed);
      pendingCommand = slash ? slash[1] : null;
      set((s) => ({
        busy: true,
        hasConversation: true,
        blocks: [...s.blocks, { kind: "user", id: nextId(), text: trimmed }],
      }));
      try {
        await invoke("agent_send", { id: AGENT_SESSION, text: trimmed });
      } catch (err) {
        set((s) => ({
          busy: false,
          blocks: [...s.blocks, {
            kind: "notice", id: nextId(),
            text: err instanceof Error ? err.message : String(err),
          }],
        }));
      }
    },

    stop: async () => {
      await invoke("agent_stop", { id: AGENT_SESSION }).catch(() => {});
      set({ running: false, busy: false });
    },

    clear: () => set({ blocks: [] }),
  };
});
