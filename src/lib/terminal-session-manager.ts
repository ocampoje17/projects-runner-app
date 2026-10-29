import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type TerminalChannelEvent } from "./api";

export function terminalTheme(theme: "light" | "dark" | undefined) {
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

export class ManagedTerminalSession {
  public readonly terminalId: number;
  public readonly terminal: Terminal;
  public readonly fitAddon: FitAddon;
  public readonly searchAddon: SearchAddon;
  public readonly containerElement: HTMLElement;
  public sessionId: string | null = null;
  public isScrolledUp = false;
  public hasNewOutput = false;
  public onStateChange?: () => void;
  public onChannelEvent?: (event: TerminalChannelEvent) => void;

  private webglAddon: WebglAddon | null = null;
  private channel: Channel<TerminalChannelEvent> | null = null;
  private unackedBytes = 0;
  private currentGeneration = 0;
  private isDisposed = false;
  private boundContainer: HTMLElement | null = null;

  constructor(
    terminalId: number,
    options: { fontFamily?: string; fontSize?: number; theme?: "light" | "dark" },
  ) {
    this.terminalId = terminalId;
    this.containerElement = document.createElement("div");
    this.containerElement.className =
      "xterm-session-host w-full h-full min-h-0 flex-1 overflow-hidden";
    this.containerElement.style.height = "100%";
    this.containerElement.style.width = "100%";

    this.terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize ?? 15,
      scrollback: 10000,
      theme: terminalTheme(options.theme),
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        try {
          const parsed = new URL(uri);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            void openUrl(uri);
          }
        } catch {
          // ignore invalid scheme
        }
      }),
    );
    this.terminal.loadAddon(this.searchAddon);

    this.terminal.open(this.containerElement);

    // Scroll tracking
    this.terminal.onScroll(() => {
      const buffer = this.terminal.buffer.active;
      const atBottom = buffer.viewportY >= buffer.baseY - 1;
      this.isScrolledUp = !atBottom;
      if (atBottom && this.hasNewOutput) {
        this.hasNewOutput = false;
      }
      this.onStateChange?.();
    });

    this.setupKeyEvents();
  }

  public enableWebgl() {
    if (this.webglAddon) return;
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
      this.terminal.loadAddon(this.webglAddon);
    } catch {
      this.webglAddon = null;
    }
  }

  public disableWebgl() {
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch {
        // ignore
      }
      this.webglAddon = null;
    }
  }

  private setupKeyEvents() {
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const copyModifier = isMac ? event.metaKey : event.ctrlKey;
      const explicitCopy = !isMac && event.ctrlKey && event.shiftKey && key === "c";
      const selectedCtrlCopy =
        !isMac && event.ctrlKey && !event.shiftKey && key === "c" && this.terminal.hasSelection();

      if (
        (copyModifier && key === "c" && (isMac || this.terminal.hasSelection())) ||
        explicitCopy ||
        selectedCtrlCopy
      ) {
        event.preventDefault();
        event.stopPropagation();
        const sel = this.terminal.getSelection();
        if (sel) {
          void writeClipboardText(sel);
        }
        return false;
      }

      // Terminal search toggle: Ctrl+Shift+F
      if ((copyModifier && event.shiftKey && key === "f") || (!isMac && event.ctrlKey && event.shiftKey && key === "f")) {
        event.preventDefault();
        event.stopPropagation();
        this.containerElement.dispatchEvent(
          new CustomEvent("terminal:toggle-search", { bubbles: true }),
        );
        return false;
      }

      const pasteShortcut =
        (copyModifier && key === "v") ||
        (!isMac && event.ctrlKey && event.shiftKey && key === "v");
      if (pasteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          const text = await readClipboardText();
          if (!text) return;
          // For pastes over 1 MiB, batch paste to prevent UI lockup
          if (text.length > 1024 * 1024) {
            const CHUNK_SIZE = 64 * 1024;
            let offset = 0;
            const sendChunk = () => {
              if (offset >= text.length || this.isDisposed) return;
              const chunk = text.slice(offset, offset + CHUNK_SIZE);
              offset += CHUNK_SIZE;
              this.terminal.paste(chunk);
              if (offset < text.length) {
                setTimeout(sendChunk, 10);
              } else {
                this.terminal.focus();
              }
            };
            sendChunk();
          } else {
            this.terminal.paste(text);
            this.terminal.focus();
          }
        })();
        return false;
      }
      return true;
    });
  }

  public attachTo(mountNode: HTMLElement, shouldFocus = false) {
    if (this.boundContainer === mountNode) return;
    this.detach();
    this.boundContainer = mountNode;
    mountNode.appendChild(this.containerElement);
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      if (shouldFocus) {
        this.terminal.focus();
      }
    });
  }

  public detach() {
    this.disableWebgl();
    if (this.boundContainer && this.containerElement.parentElement === this.boundContainer) {
      this.boundContainer.removeChild(this.containerElement);
    }
    this.boundContainer = null;
  }

  public createChannel(): Channel<TerminalChannelEvent> {
    const channel = new Channel<TerminalChannelEvent>();
    this.channel = channel;
    channel.onmessage = (event: TerminalChannelEvent) => {
      this.handleChannelEvent(event);
    };
    return channel;
  }

  public getChannel(): Channel<TerminalChannelEvent> | null {
    return this.channel;
  }

  public handleChannelEvent(event: TerminalChannelEvent) {
    if (this.isDisposed) return;

    if (event.type === "started") {
      this.sessionId = event.session_id;
      this.currentGeneration = event.generation;
      this.unackedBytes = 0;
      this.onStateChange?.();
    } else if (event.type === "output") {
      if (event.generation !== this.currentGeneration) return;
      try {
        const binaryString = atob(event.data);
        const seq = event.sequence;
        const bytesLen = binaryString.length;
        this.unackedBytes += bytesLen;

        const bytes = new Uint8Array(bytesLen);
        for (let i = 0; i < bytesLen; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const buffer = this.terminal.buffer.active;
        const wasAtBottom = buffer.viewportY >= buffer.baseY - 1;

        this.terminal.write(bytes, () => {
          // Send ACK backpressure after xterm render callback!
          if (this.sessionId) {
            void api.ackTerminalOutput(this.sessionId, event.generation, seq, bytesLen);
            this.unackedBytes = Math.max(0, this.unackedBytes - bytesLen);
          }
          if (wasAtBottom) {
            this.terminal.scrollToBottom();
          } else {
            this.hasNewOutput = true;
            this.onStateChange?.();
          }
        });
      } catch (err) {
        console.error("Failed to decode terminal output:", err);
      }
    } else if (event.type === "exited") {
      if (event.generation === this.currentGeneration) {
        this.onStateChange?.();
      }
    }
    this.onChannelEvent?.(event);
  }

  public scrollToBottom() {
    this.terminal.scrollToBottom();
    this.isScrolledUp = false;
    this.hasNewOutput = false;
    this.onStateChange?.();
  }

  public search(query: string, options?: ISearchOptions): boolean {
    if (!query) {
      this.searchAddon.clearDecorations();
      return true;
    }
    try {
      return this.searchAddon.findNext(query, options);
    } catch {
      return false;
    }
  }

  public searchPrevious(query: string, options?: ISearchOptions): boolean {
    if (!query) return true;
    try {
      return this.searchAddon.findPrevious(query, options);
    } catch {
      return false;
    }
  }

  public dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.detach();
    if (this.sessionId) {
      void api.stopInteractiveCommand(this.sessionId).catch(() => {});
    }
    this.searchAddon.dispose();
    this.fitAddon.dispose();
    this.webglAddon?.dispose();
    this.terminal.dispose();
  }
}

class TerminalSessionManagerSingleton {
  private sessions = new Map<number, ManagedTerminalSession>();

  public getOrCreate(
    terminalId: number,
    options: { fontFamily?: string; fontSize?: number; theme?: "light" | "dark" },
  ): ManagedTerminalSession {
    let session = this.sessions.get(terminalId);
    if (!session) {
      session = new ManagedTerminalSession(terminalId, options);
      this.sessions.set(terminalId, session);
    }
    return session;
  }

  public get(terminalId: number): ManagedTerminalSession | undefined {
    return this.sessions.get(terminalId);
  }

  public destroy(terminalId: number) {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.dispose();
      this.sessions.delete(terminalId);
    }
  }

  public destroyAll() {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}

export const TerminalSessionManager = new TerminalSessionManagerSingleton();
