import "@xterm/xterm/css/xterm.css";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export function XtermTerminal({
  content,
  fontFamily,
  fontSize,
  onData,
  onSizeChange,
  readOnly = true,
  theme,
}: {
  content: string;
  fontFamily?: string;
  fontSize?: number;
  onData?: (data: string) => void;
  onSizeChange?: (cols: number, rows: number) => void;
  readOnly?: boolean;
  theme?: "light" | "dark";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastContentRef = useRef("");
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const onDataRef = useRef(onData);
  const onSizeChangeRef = useRef(onSizeChange);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onSizeChangeRef.current = onSizeChange;
  }, [onSizeChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const isDark = theme === "dark";
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: !readOnly,
      cursorStyle: "block",
      disableStdin: readOnly,
      fontFamily,
      fontSize,
      scrollback: 10000,
      theme: {
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
      },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminalRef.current = terminal;

    const syncSize = () => {
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

    return () => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      disposeOnData?.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastSizeRef.current = null;
    };
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
      terminal.clear();
      terminal.reset();
      lastContentRef.current = "";
      fitAddonRef.current?.fit();
      return;
    }

    if (!previous || !content.startsWith(previous)) {
      terminal.reset();
      terminal.write(content);
    } else {
      terminal.write(content.slice(previous.length));
    }

    lastContentRef.current = content;
    terminal.scrollToBottom();
  }, [content]);

  return <div className="xterm-host h-full min-h-0 flex-1 overflow-hidden" ref={containerRef} />;
}
