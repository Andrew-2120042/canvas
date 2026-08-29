import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const AGENT_SESSION = "main";

/** One rendered block in the conversation. */
export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
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
          added.push({ kind: "text", id: nextId(), text: c.text });
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
