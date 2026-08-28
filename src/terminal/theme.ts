import type { ITheme } from "@xterm/xterm";

/**
 * Terminal palette drawn from the app's own tokens rather than a stock
 * terminal scheme — the panel should read as part of this app, not as an
 * emulator embedded in it.
 */
export const terminalTheme: ITheme = {
  background: "#242424",
  foreground: "#EAEAEA",
  cursor: "#2B7FFF",
  cursorAccent: "#242424",
  selectionBackground: "rgba(43, 127, 255, 0.30)",

  black: "#2A2A2A",
  red: "#E8622A",
  green: "#2F8F5B",
  yellow: "#D9A441",
  blue: "#2B7FFF",
  magenta: "#A46FD1",
  cyan: "#3FA9A6",
  white: "#C4C4C4",

  brightBlack: "#5A5A5A",
  brightRed: "#F0805A",
  brightGreen: "#4FB37C",
  brightYellow: "#E8C06A",
  brightBlue: "#5E9CFF",
  brightMagenta: "#BE93E4",
  brightCyan: "#5FC7C4",
  brightWhite: "#F2F2F2",
};
