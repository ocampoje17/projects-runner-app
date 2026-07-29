import "@xterm/xterm/css/xterm.css";

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  registerTerminalController,
  type RegisteredTerminalController,
} from "../lib/terminal-registry";

export type XtermTerminalHandle = RegisteredTerminalController & {
  fit: () => void;
};

async function readClipboardText() {
  try {
    return await readText();
  } catch {
    return navigator.clipboard.readText();
  }
}

async function writeClipboardText(value: string) {
  try {
    await writeText(value);
  } catch {
    await navigator.clipboard.writeText(value);
  }
}

function terminalTheme(theme: "light" | "dark" | undefined) {
  const isDark = theme === "dark";
  return {
    background: "#00000000",
    foreground: isDark ? "#e8e8e8" : "#18181b",
    black: isDark ? "#1f1f23" : "#27272a",
    blue: isDark ? "#60a5fa" : "#2563eb",
    brightBlack: isDark ? "#71717a" : "#52525b",
    brightBlue: isDark ? "#93c5fd" : "#3b82f6",
    brightCyan: isDark ? "#67e8f9" : "#0891b2",
    brightGreen: isDark ? "#4ade80" : "#16a34a",
    brightMagenta: isDark ? "#c084fc" : "#9333ea",
    brightRed: isDark ? "#fb7185" : "#dc2626",
    brightWhite: isDark ? "#fafafa" : "#27272a",
    brightYellow: isDark ? "#facc15" : "#d97706",
    cyan: isDark ? "#22d3ee" : "#0f766e",
    green: isDark ? "#22c55e" : "#15803d",
    magenta: isDark ? "#a78bfa" : "#7e22ce",
    red: isDark ? "#f87171" : "#b91c1c",
    white: isDark ? "#e4e4e7" : "#3f3f46",
    yellow: isDark ? "#fbbf24" : "#ca8a04",
  };
}

export const XtermTerminal = forwardRef<XtermTerminalHandle, {
  terminalId?: number;
  active?: boolean;
  content: string;
  fontFamily?: string;
  fontSize?: number;
  onData?: (data: string) => void;
  onSizeChange?: (cols: number, rows: number) => void;
  readOnly?: boolean;
  theme?: "light" | "dark";
}>(function XtermTerminal({
  terminalId,
  active = true,
  content,
  fontFamily,
  fontSize,
  onData,
  onSizeChange,
  readOnly = true,
  theme,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastContentRef = useRef("");
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const onDataRef = useRef(onData);
  const onSizeChangeRef = useRef(onSizeChange);
  const activeRef = useRef(active);

  const controllerRef = useRef<XtermTerminalHandle>({
    clear: () => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.clear();
      terminal.write("\x1b[2J\x1b[H");
      lastContentRef.current = "";
    },
    copySelection: async () => {
      const terminal = terminalRef.current;
      if (!terminal?.hasSelection()) return false;
      await writeClipboardText(terminal.getSelection());
      return true;
    },
    fit: () => fitAddonRef.current?.fit(),
    focus: () => terminalRef.current?.focus(),
    hasSelection: () => terminalRef.current?.hasSelection() ?? false,
    pasteFromClipboard: async () => {
      const terminal = terminalRef.current;
      if (!terminal || terminal.options.disableStdin) return;
      terminal.paste(await readClipboardText());
      terminal.focus();
    },
    selectAll: () => terminalRef.current?.selectAll(),
    write: (data: string) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      const buffer = terminal.buffer.active;
      const wasAtBottom = buffer.viewportY >= buffer.baseY;
      terminal.write(data, () => {
        if (wasAtBottom) terminal.scrollToBottom();
      });
    },
  });

  useImperativeHandle(forwardedRef, () => controllerRef.current, []);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onSizeChangeRef.current = onSizeChange;
  }, [onSizeChange]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      });
    }
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: !readOnly,
      cursorStyle: "block",
      disableStdin: readOnly,
      fontFamily,
      fontSize,
      scrollback: 10000,
      theme: terminalTheme(theme),
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminalRef.current = terminal;

    const syncSize = () => {
      if (!activeRef.current || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      fitAddon.fit();
      const nextSize = { cols: terminal.cols, rows: terminal.rows };
      const previousSize = lastSizeRef.current;
      if (previousSize?.cols === nextSize.cols && previousSize?.rows === nextSize.rows) {
        return;
      }

      lastSizeRef.current = nextSize;
      onSizeChangeRef.current?.(nextSize.cols, nextSize.rows);
    };

    syncSize();
    lastContentRef.current = "";
    let resizeFrame: number | null = null;

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }

      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        syncSize();
      });
    });
    resizeObserver.observe(container);

    const disposeOnData = terminal.onData((value) => {
      onDataRef.current?.(value);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const copyModifier = isMac ? event.metaKey : event.ctrlKey;
      const explicitCopy = !isMac && event.ctrlKey && event.shiftKey && key === "c";
      const selectedCtrlCopy = !isMac && event.ctrlKey && !event.shiftKey && key === "c" && terminal.hasSelection();

      if ((copyModifier && key === "c" && (isMac || terminal.hasSelection())) || explicitCopy || selectedCtrlCopy) {
        event.preventDefault();
        event.stopPropagation();
        void controllerRef.current.copySelection();
        return false;
      }

      const pasteShortcut =
        (copyModifier && key === "v") ||
        (!isMac && event.ctrlKey && event.shiftKey && key === "v");
      if (pasteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        void controllerRef.current.pasteFromClipboard();
        return false;
      }
      return true;
    });

    const unregister = terminalId === undefined
      ? () => {}
      : registerTerminalController(terminalId, controllerRef.current);

    return () => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      disposeOnData?.dispose();
      resizeObserver.disconnect();
      unregister();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastSizeRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize ?? 15;
    terminal.options.disableStdin = readOnly;
    terminal.options.cursorBlink = !readOnly;
    terminal.options.theme = terminalTheme(theme);
    requestAnimationFrame(() => fitAddonRef.current?.fit());
  }, [fontFamily, fontSize, readOnly, theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const previous = lastContentRef.current;
    if (content === previous) {
      return;
    }

    if (!content) {
      controllerRef.current.clear();
      lastContentRef.current = "";
      fitAddonRef.current?.fit();
      return;
    }

    if (!previous || !content.startsWith(previous)) {
      controllerRef.current.clear();
      terminal.write(content);
    } else {
      terminal.write(content.slice(previous.length));
    }

    lastContentRef.current = content;
  }, [content]);

  return (
    <div
      className="xterm-host h-full min-h-0 flex-1 overflow-hidden"
      data-terminal-id={terminalId}
      ref={containerRef}
    />
  );
});
