import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const AGENT_SESSION = "main";

/** One rendered block in the conversation. */
export type Block =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "text"; id: string; text: string;
      /** Choices the agent offered in prose, lifted out so they can be
       *  clicked instead of retyped. */
      options?: string[];
      /** The command those choices belong to, e.g. "model". */
      optionCommand?: string;
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
  /** Models the agent said it accepts, learned from a /model reply. */
  models: string[];
  busy: boolean;
  blocks: Block[];
  info: SessionInfo;
  error: string | null;

  start: (cwd: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
}

let seq = 0;
const nextId = () => `b${seq++}`;
/** The slash command awaiting a reply, so any choices in it can be labelled. */
let pendingCommand: string | null = null;

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

/**
 * Pull a list of choices out of an agent's prose.
 *
 * Slash commands answer with text like
 *   "Usage: /model <name>. Available: sonnet, opus, haiku, ..."
 * which tells a person what they can pick but leaves them to retype it. This
 * lifts the list so the UI can offer the choices directly.
 */
export function extractOptions(text: string): string[] {
  const m = /Available:\s*([^.\n]+)/i.exec(text);
  if (!m) return [];
  return m[1]
    .split(/,|\bor\b/)
    .map((p) => p.trim().replace(/^`|`$/g, ""))
    .filter((p) => p && p.length < 40 && !/\s{2,}/.test(p))
    // Trailing prose like "or a full model ID" is guidance, not a choice.
    .filter((p) => !/^a\s|\bID\b/i.test(p));
}

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
      for (const c of content) {
        if (c.type === "text" && c.text?.trim()) {
          const options = extractOptions(c.text);
          if (options.length && pendingCommand === "model") {
            set({ models: options });
          }
          // The model label comes from the one-off init event, so a later
          // /model change would leave it stale. Take the confirmation as the
          // authority rather than assuming the switch worked.
          const switched = /Set model to\s*`?([^`\n(]+)`?/i.exec(c.text);
          if (switched && pendingCommand === "model") {
            set((st) => ({ info: { ...st.info, model: switched[1].trim() } }));
          }
          added.push({
            kind: "text", id: nextId(), text: c.text,
            ...(options.length
              ? { options, optionCommand: pendingCommand ?? undefined }
              : {}),
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

  return {
    running: false,
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
      try {
        await invoke("agent_start", { id: AGENT_SESSION, cwd });
        set({ running: true, error: null });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err), running: false });
      }
    },

    send: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().busy) return;
      const slash = /^\/(\w[\w-]*)/.exec(trimmed);
      pendingCommand = slash ? slash[1] : null;
      set((s) => ({
        busy: true,
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
