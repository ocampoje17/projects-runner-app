import "@xterm/xterm/css/xterm.css";

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  Regex,
  WholeWord,
  X,
} from "lucide-react";
import {
  registerTerminalController,
  type RegisteredTerminalController,
} from "../lib/terminal-registry";
import {
  TerminalSessionManager,
  ManagedTerminalSession,
  terminalTheme,
} from "../lib/terminal-session-manager";

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

export const XtermTerminal = forwardRef<
  XtermTerminalHandle,
  {
    terminalId?: number;
    active?: boolean;
    content: string;
    fontFamily?: string;
    fontSize?: number;
    onData?: (data: string) => void;
    onSizeChange?: (cols: number, rows: number) => void;
    readOnly?: boolean;
    theme?: "light" | "dark";
  }
>(function XtermTerminal(
  {
    terminalId,
    active = true,
    content,
    fontFamily,
    fontSize,
    onData,
    onSizeChange,
    readOnly = true,
    theme,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ManagedTerminalSession | null>(null);
  const lastContentRef = useRef("");
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const onDataRef = useRef(onData);
  const onSizeChangeRef = useRef(onSizeChange);
  const activeRef = useRef(active);

  // Search UI state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  // Scroll state (updated by session callback)
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [hasNewOutput, setHasNewOutput] = useState(false);

  const controllerRef = useRef<XtermTerminalHandle>({
    clear: () => {
      const session = sessionRef.current;
      if (!session) return;
      session.terminal.clear();
      session.terminal.write("\x1b[2J\x1b[H");
      lastContentRef.current = "";
    },
    copySelection: async () => {
      const session = sessionRef.current;
      if (!session?.terminal.hasSelection()) return false;
      await writeClipboardText(session.terminal.getSelection());
      return true;
    },
    fit: () => sessionRef.current?.fitAddon.fit(),
    focus: () => sessionRef.current?.terminal.focus(),
    hasSelection: () => sessionRef.current?.terminal.hasSelection() ?? false,
    pasteFromClipboard: async () => {
      const session = sessionRef.current;
      if (!session || session.terminal.options.disableStdin) return;
      session.terminal.paste(await readClipboardText());
      session.terminal.focus();
    },
    selectAll: () => sessionRef.current?.terminal.selectAll(),
    write: (data: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const buffer = session.terminal.buffer.active;
      const wasAtBottom = buffer.viewportY >= buffer.baseY - 1;
      session.terminal.write(data, () => {
        if (wasAtBottom) session.terminal.scrollToBottom();
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
      sessionRef.current?.enableWebgl();
      requestAnimationFrame(() => {
        sessionRef.current?.fitAddon.fit();
        sessionRef.current?.terminal.focus();
      });
    } else {
      sessionRef.current?.disableWebgl();
    }
  }, [active]);

  // Attach / Detach managed session without destroying terminal instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const id = terminalId ?? -999999;
    const session = TerminalSessionManager.getOrCreate(id, {
      fontFamily,
      fontSize,
      theme,
    });
    sessionRef.current = session;

    session.onStateChange = () => {
      setIsScrolledUp(session.isScrolledUp);
      setHasNewOutput(session.hasNewOutput);
    };

    session.attachTo(container, activeRef.current);
    if (activeRef.current) {
      session.enableWebgl();
    } else {
      session.disableWebgl();
    }

    const handleToggleSearch = () => {
      setShowSearch((prev) => !prev);
    };
    container.addEventListener("terminal:toggle-search", handleToggleSearch);

    const syncSize = () => {
      if (!activeRef.current || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      session.fitAddon.fit();
      const nextSize = { cols: session.terminal.cols, rows: session.terminal.rows };
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

    const disposeOnData = session.terminal.onData((value) => {
      onDataRef.current?.(value);
    });

    const disposeOnBinary = session.terminal.onBinary((value) => {
      onDataRef.current?.(value);
    });

    const disposeOnResize = session.terminal.onResize(({ cols, rows }) => {
      onSizeChangeRef.current?.(cols, rows);
    });

    const unregister =
      terminalId === undefined
        ? () => {}
        : registerTerminalController(terminalId, controllerRef.current);

    return () => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      container.removeEventListener("terminal:toggle-search", handleToggleSearch);
      disposeOnData.dispose();
      disposeOnBinary.dispose();
      disposeOnResize.dispose();
      resizeObserver.disconnect();
      unregister();
      // Notice: DO NOT call session.dispose()! Only detach DOM node to persist session across tabs/panels!
      session.detach();
      sessionRef.current = null;
      lastSizeRef.current = null;
    };
  }, [terminalId]);

  // Update terminal options dynamically
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (fontFamily !== undefined) {
      session.terminal.options.fontFamily = fontFamily;
    }
    if (fontSize !== undefined) {
      session.terminal.options.fontSize = fontSize;
    }
    session.terminal.options.disableStdin = readOnly;
    session.terminal.options.cursorBlink = !readOnly;
    session.terminal.options.theme = terminalTheme(theme);
    if (activeRef.current) {
      requestAnimationFrame(() => {
        session.fitAddon.fit();
        const nextCols = session.terminal.cols;
        const nextRows = session.terminal.rows;
        if (lastSizeRef.current?.cols !== nextCols || lastSizeRef.current?.rows !== nextRows) {
          lastSizeRef.current = { cols: nextCols, rows: nextRows };
          onSizeChangeRef.current?.(nextCols, nextRows);
        }
      });
    }
  }, [fontFamily, fontSize, readOnly, theme]);

  // Sync content if provided (for static / batch logs)
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // For active interactive sessions, content is streamed directly via Channel
    if (!readOnly && session.sessionId) return;

    const previous = lastContentRef.current;
    if (content === previous) return;

    if (!content) {
      controllerRef.current.clear();
      lastContentRef.current = "";
      session.fitAddon.fit();
      return;
    }

    if (!previous || !content.startsWith(previous)) {
      controllerRef.current.clear();
      session.terminal.write(content);
    } else {
      session.terminal.write(content.slice(previous.length));
    }

    lastContentRef.current = content;
  }, [content, readOnly]);

  // Search logic
  const performSearch = useCallback(
    (query: string, reverse = false) => {
      const session = sessionRef.current;
      if (!session) return;

      setRegexError(null);
      if (useRegex && query) {
        try {
          new RegExp(query);
        } catch (e) {
          setRegexError((e as Error).message);
          return;
        }
      }

      const options = {
        regex: useRegex,
        caseSensitive: matchCase,
        wholeWord,
        incremental: true,
      };

      if (reverse) {
        session.searchPrevious(query, options);
      } else {
        session.search(query, options);
      }
    },
    [matchCase, wholeWord, useRegex],
  );

  useEffect(() => {
    if (showSearch) {
      performSearch(searchQuery);
    }
  }, [showSearch, searchQuery, performSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setShowSearch((prev) => !prev);
    } else if (e.key === "Escape" && showSearch) {
      setShowSearch(false);
      sessionRef.current?.search("");
      sessionRef.current?.terminal.focus();
    }
  };

  const handleScrollToBottom = () => {
    sessionRef.current?.scrollToBottom();
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Search Bar Overlay */}
      {showSearch && (
        <div className="absolute right-4 top-2 z-20 flex items-center gap-1.5 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor-background,#1e1e1e)] p-1.5 shadow-md">
          <div className="relative flex items-center">
            <input
              type="text"
              className={`h-6 w-48 rounded-[4px] border bg-[var(--vscode-input-background,#2d2d2d)] px-2 text-xs text-[var(--vscode-foreground)] placeholder-[var(--vscode-descriptionForeground)] focus:outline-none ${
                regexError ? "border-red-500 focus:border-red-500" : "border-[var(--vscode-input-border,transparent)] focus:border-[var(--vscode-focusBorder)]"
              }`}
              placeholder="Find..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  performSearch(searchQuery, e.shiftKey);
                }
              }}
              autoFocus
            />
            {regexError && (
              <span
                className="absolute -bottom-5 left-0 z-30 truncate text-[10px] text-red-400"
                title={regexError}
              >
                Invalid regex
              </span>
            )}
          </div>

          <button
            type="button"
            className={`flex h-6 w-6 items-center justify-center rounded text-xs transition-colors ${
              matchCase
                ? "bg-[var(--primary-color)] text-white"
                : "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            }`}
            onClick={() => setMatchCase((v) => !v)}
            title="Match Case"
          >
            <CaseSensitive size={13} />
          </button>

          <button
            type="button"
            className={`flex h-6 w-6 items-center justify-center rounded text-xs transition-colors ${
              wholeWord
                ? "bg-[var(--primary-color)] text-white"
                : "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            }`}
            onClick={() => setWholeWord((v) => !v)}
            title="Match Whole Word"
          >
            <WholeWord size={13} />
          </button>

          <button
            type="button"
            className={`flex h-6 w-6 items-center justify-center rounded text-xs transition-colors ${
              useRegex
                ? "bg-[var(--primary-color)] text-white"
                : "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            }`}
            onClick={() => setUseRegex((v) => !v)}
            title="Use Regular Expression"
          >
            <Regex size={13} />
          </button>

          <div className="mx-0.5 h-3.5 w-px bg-[var(--vscode-border)]" />

          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            onClick={() => performSearch(searchQuery, true)}
            title="Previous Match (Shift+Enter)"
          >
            <ArrowUp size={13} />
          </button>

          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            onClick={() => performSearch(searchQuery, false)}
            title="Next Match (Enter)"
          >
            <ArrowDown size={13} />
          </button>

          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            onClick={() => {
              setShowSearch(false);
              sessionRef.current?.search("");
              sessionRef.current?.terminal.focus();
            }}
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Floating Scroll-to-Bottom / New Output Badge */}
      {isScrolledUp && (
        <div className="absolute bottom-4 right-6 z-20">
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-lg transition-all ${
              hasNewOutput
                ? "animate-pulse bg-[var(--primary-color)] text-white hover:brightness-110"
                : "border border-[var(--vscode-border)] bg-[var(--vscode-editor-background,#1e1e1e)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            }`}
            onClick={handleScrollToBottom}
            title="Scroll to bottom"
          >
            <ChevronDown size={14} />
            <span>{hasNewOutput ? "New output" : "Scroll to bottom"}</span>
          </button>
        </div>
      )}

      {/* Terminal Mount Node */}
      <div
        className="xterm-host h-full min-h-0 flex-1 overflow-hidden"
        data-terminal-id={terminalId}
        ref={containerRef}
      />
    </div>
  );
});
