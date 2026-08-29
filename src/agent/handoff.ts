/**
 * Commands that only a real terminal can run.
 *
 * These are CLI-level, not agent-level: /login performs an OAuth handoff
 * through the browser and writes credentials, /mcp authorises a server the
 * same way. Headless mode answers them with "isn't available in this
 * environment" because there is no channel for the interaction, so the panel
 * offers to carry the same conversation into the terminal instead of
 * pretending it can do it.
 */
const TERMINAL_ONLY = [
  "login", "logout", "mcp", "permissions", "config",
  "doctor", "install", "upgrade", "status", "help",
];

export function isTerminalOnly(command: string): boolean {
  return TERMINAL_ONLY.includes(command.replace(/^\//, "").toLowerCase());
}

/**
 * Spot a reply that is really saying "do this in a terminal".
 *
 * Rather than matching prose, look for the command the agent named: a reply
 * that mentions /login while telling you it cannot run it is a handoff.
 */
export function detectHandoff(text: string): string | null {
  if (!/interactive|in the terminal|terminal for details|isn't available/i.test(text)) {
    return null;
  }
  for (const m of text.matchAll(/\/([a-z][a-z-]*)/gi)) {
    if (isTerminalOnly(m[1])) return `/${m[1].toLowerCase()}`;
  }
  return null;
}
