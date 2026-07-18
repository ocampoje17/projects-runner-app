import { Tooltip } from "./motion/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { EntityAvatar } from "./entity-avatar";
import { XtermTerminal } from "./xterm-terminal";
import { createPortal } from "react-dom";
import { commandPorts, normalizeCommandScript, runtimeModeLabel } from "../lib/command-utils";
import type { Project, ProjectCommand } from "../lib/api";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";
import { interactiveTerminalLabel } from "../lib/interactive-terminal";
import { BrushCleaning, ChevronDown, FolderOpen, Keyboard, Loader2, Maximize2, Minimize2, Pencil, Play, Plus, PowerOff, RotateCcw, Square, Terminal, Trash2, X } from "lucide-react";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type RunState = {
  runId: number;
  commandId: number;
  status: "running" | "exited" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
};

export type LogLine = {
  id: string;
  runId: number;
  commandId: number;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
};

type TerminalFilter = "all" | "internal_interactive" | "internal_headless" | "external_terminal";

function runtimeModeBadgeLabel(command: ProjectCommand) {
  if (command.runtime_mode === "external_terminal") {
    return "External";
  }
  return null;
}

function formatRunCountLabel(runCount: number) {
  return `${runCount} run${runCount === 1 ? "" : "s"}`;
}

function terminalFilterLabel(value: TerminalFilter) {
  if (value === "internal_interactive") return "Interactive";
  if (value === "internal_headless") return "Headless";
  if (value === "external_terminal") return "External";
  return "All terminals";
}

function matchesTerminalFilter(command: ProjectCommand, filter: TerminalFilter) {
  if (filter === "all") return true;
  return command.runtime_mode === filter;
}

const terminalDropdownTriggerClassName =
  "h-7 rounded-[4px] border border-transparent bg-transparent px-2 text-left text-[11.5px] text-[var(--vscode-foreground)]/84 transition-[background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)] data-[state=open]:border-[var(--vscode-border)] data-[state=open]:bg-[var(--vscode-list-hover)] data-[state=open]:text-foreground";

const terminalDropdownMenuClassName =
  "fixed z-[2300] min-w-[8rem] overflow-hidden rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-1.5 text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.24)]";

const terminalDropdownItemClassName =
  "relative flex min-h-8 w-full cursor-default items-center rounded-[4px] border border-transparent py-1.5 pl-3 pr-3 text-[12px] font-normal text-[var(--vscode-foreground)] outline-none transition-[background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground";

export function CommandCard({
  command,
  onDelete,
  onEdit,
  onKillPorts,
  onOpenDetail,
  onRestart,
  onRun,
  onStop,
  onForceStop,
  onOpenLogs,
  run,
  isStopping = false,
  isRestarting = false,
  isScanningPorts = false,
}: {
  command: ProjectCommand;
  onDelete: () => void;
  onEdit: () => void;
  onKillPorts: () => void;
  onOpenDetail?: () => void;
  onRestart: () => void;
  onRun: () => void;
  onStop: () => void;
  onForceStop: () => void;
  onOpenLogs: () => void;
  run?: RunState;
  isStopping?: boolean;
  isRestarting?: boolean;
  isScanningPorts?: boolean;
}) {
  const isRunning = run?.status === "running";
  const stopClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { allowRichMotion } = useMotionPreferences();

  useEffect(() => () => {
    if (stopClickTimeout.current) clearTimeout(stopClickTimeout.current);
  }, []);
  const badgeVariant = isRunning ? "success" : run?.status === "failed" ? "danger" : "muted";
  const ports = commandPorts(command);
  const normalizedScript = normalizeCommandScript(command.script);

  return (
    <Card
      className={cn(
        "w-full self-start overflow-hidden rounded-[8px] border-[var(--vscode-border)] bg-[var(--vscode-panel)] shadow-none transition-[border-color,background-color]",
        isRunning && "command-card-running border-success/25",
        run?.status === "failed" ? "command-card-failed border-destructive/30" : allowRichMotion && "hover:border-border-strong hover:bg-[var(--bg-card-hover)]",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-[var(--vscode-border)] bg-transparent px-3 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <EntityAvatar name={command.name} path={command.avatar_path} />
          <div className="min-w-0">
            <h3 className="truncate text-[12px] font-semibold tracking-[0.01em] text-foreground">{command.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={badgeVariant}>{run?.status ?? "ready"}</Badge>
              <Badge variant="muted">{command.section}</Badge>
              <Badge variant="muted">{formatRunCountLabel(command.run_count)}</Badge>
              {runtimeModeBadgeLabel(command) && <Badge variant="muted">{runtimeModeBadgeLabel(command)}</Badge>}
              {command.runtime_mode === "internal_interactive" ? (
                <Tooltip content="Interactive terminal">
                  <Badge
                    variant="muted"
                    className="min-w-[22px] cursor-default justify-center px-1.5"
                    aria-label="Interactive terminal"
                  >
                    <Keyboard size={12} />
                  </Badge>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Edit command">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} aria-label="Edit command">
              <Pencil size={14} />
            </Button>
          </Tooltip>
          <Tooltip content="Delete command">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete} aria-label="Delete command">
              <Trash2 size={14} />
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 px-3 py-3">
        {ports.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {ports.map((port) => (
              <Badge key={port} variant="muted">
                :{port}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/44">No tracked ports</div>
        )}
        <pre className="max-h-[calc(1.5em*4+0.75rem)] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-2.5 py-2 font-mono text-[10.5px] leading-6 text-[var(--script-preview-color)]">{normalizedScript}</pre>
        <div className="flex flex-wrap items-center gap-1 border-t border-[var(--vscode-border)] pt-2">
          <Tooltip content={isStopping ? "Stopping" : isRunning ? "Stop - double-click to force stop" : "Run"}>
            <Button
              size="icon"
              variant={isRunning || isStopping ? "outline" : "primary"}
              disabled={isStopping}
              className={cn(
                "h-8 w-8 shrink-0",
                (isRunning || isStopping) && "border-destructive text-destructive hover:bg-destructive/10",
              )}
              onClick={() => {
                if (isStopping) return;
                if (isRunning) {
                  // Wait briefly so a double-click can be used as the
                  // recovery action without sending two Stop requests.
                  if (stopClickTimeout.current) clearTimeout(stopClickTimeout.current);
                  stopClickTimeout.current = setTimeout(() => {
                    stopClickTimeout.current = null;
                    onStop();
                  }, 220);
                }
                else onRun();
              }}
              onDoubleClick={() => {
                if (!isRunning || isStopping) return;
                if (stopClickTimeout.current) {
                  clearTimeout(stopClickTimeout.current);
                  stopClickTimeout.current = null;
                }
                onForceStop();
              }}
              aria-label={isStopping ? `Stopping ${command.name}` : isRunning ? `Stop ${command.name}` : `Run ${command.name}`}
            >
              {isStopping ? <Loader2 size={13} className="animate-spin" /> : isRunning ? <Square size={13} /> : <Play size={13} />}
            </Button>
          </Tooltip>
          {isRunning && (
            <Tooltip content={isRestarting ? "Restarting" : "Rerun"}>
              <Button
                size="icon"
                variant="secondary"
                disabled={isRestarting}
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  if (!isRestarting) onRestart();
                }}
                aria-label={isRestarting ? `Restarting ${command.name}` : `Rerun ${command.name}`}
              >
                {isRestarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </Button>
            </Tooltip>
          )}
          <Tooltip content={isScanningPorts ? "Scanning ports..." : "Kill ports"}>
            <Button
              size="icon"
              variant="secondary"
              onClick={onKillPorts}
              disabled={ports.length === 0 || isScanningPorts}
              aria-label="Kill ports"
              className="h-8 w-8 shrink-0"
            >
              {isScanningPorts ? <Loader2 size={13} className="animate-spin" /> : <PowerOff size={13} />}
            </Button>
          </Tooltip>
          <Tooltip content="Logs">
            <Button size="icon" variant="secondary" onClick={onOpenLogs} aria-label="Logs" className="h-8 w-8 shrink-0">
              <Terminal size={13} />
            </Button>
          </Tooltip>
          {onOpenDetail ? (
            <Button size="sm" variant="ghost" className="ml-auto h-8 px-2.5 text-[11.5px]" onClick={onOpenDetail}>
              <Maximize2 size={13} />
              Open detail
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function LogPanel({
  activeCommandId,
  commands,
  projects,
  openCommandIds,
  onActiveCommandChange,
  onClear,
  onCloseTab,
  onTerminalInput,
  onTerminalResize,
  onOpenAdHocInteractiveTerminal,
  onRequestCloseAllTabs,
  interactiveTerminalOptions,
  runs,
  terminalContentByCommandId,
  terminalFontFamily,
  terminalFontSize,
  theme,
}: {
  activeCommandId: number | null;
  commands: ProjectCommand[];
  projects: Project[];
  openCommandIds: number[];
  onActiveCommandChange: (commandId: number) => void;
  onClear: (commandId: number) => void;
  onCloseTab: (commandId: number) => void;
  onTerminalInput: (commandId: number, data: string) => void;
  onTerminalResize: (commandId: number, cols: number, rows: number) => void;
  onOpenAdHocInteractiveTerminal: (project: Project, terminalKind: InteractiveTerminalKind) => void;
  onRequestCloseAllTabs: (commandIds: number[]) => void;
  interactiveTerminalOptions: InteractiveTerminalOption[];
  runs: Record<number, RunState>;
  terminalContentByCommandId: Record<number, string>;
  terminalFontFamily: string;
  terminalFontSize: string;
  theme: "light" | "dark";
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalFilterTriggerRef = useRef<HTMLDivElement | null>(null);
  const terminalFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const interactiveTerminalTriggerRef = useRef<HTMLDivElement | null>(null);
  const interactiveTerminalMenuRef = useRef<HTMLDivElement | null>(null);
  const previousVisibleCountRef = useRef(0);
  const [portalReady, setPortalReady] = useState(false);
  const [activePanelView, setActivePanelView] = useState<"terminal" | "environments">("terminal");
  const [terminalFilter, setTerminalFilter] = useState<TerminalFilter>("all");
  const [terminalFilterMenuOpen, setTerminalFilterMenuOpen] = useState(false);
  const [selectedInteractiveTerminalKind, setSelectedInteractiveTerminalKind] = useState<InteractiveTerminalKind>(
    interactiveTerminalOptions[0]?.id ?? "powershell",
  );
  const [interactiveTerminalMenuOpen, setInteractiveTerminalMenuOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem("logPanelHeight");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) {
        return Math.max(150, Math.min(800, parsed));
      }
    }
    return 350;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem("logPanelCollapsed");
    // Default to minimized; expand only when user restores or a terminal tab opens.
    return saved !== "false";
  });
  const [terminalFilterMenuPosition, setTerminalFilterMenuPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [interactiveTerminalMenuPosition, setInteractiveTerminalMenuPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("logPanelHeight", String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    localStorage.setItem("logPanelCollapsed", String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (!isCollapsed) {
      return;
    }
    setInteractiveTerminalMenuOpen(false);
    setTerminalFilterMenuOpen(false);
  }, [isCollapsed]);

  useEffect(() => {
    if (interactiveTerminalOptions.some((option) => option.id === selectedInteractiveTerminalKind)) {
      return;
    }
    setSelectedInteractiveTerminalKind(interactiveTerminalOptions[0]?.id ?? "powershell");
  }, [interactiveTerminalOptions, selectedInteractiveTerminalKind]);

  useEffect(() => {
    if (!interactiveTerminalMenuOpen && !terminalFilterMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setInteractiveTerminalMenuOpen(false);
        setTerminalFilterMenuOpen(false);
        return;
      }
      if (!target.closest("[data-interactive-terminal-menu]")) {
        setInteractiveTerminalMenuOpen(false);
      }
      if (!target.closest("[data-terminal-filter-menu]")) {
        setTerminalFilterMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInteractiveTerminalMenuOpen(false);
        setTerminalFilterMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [interactiveTerminalMenuOpen, terminalFilterMenuOpen]);

  const positionDropdownMenu = useCallback(
    (
      trigger: HTMLDivElement | null,
      menu: HTMLDivElement | null,
      setPosition: (position: { left: number; top: number }) => void,
    ) => {
      if (!trigger || !menu) {
        return;
      }

      const gap = 6;
      const margin = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const collapsedAnchorTop = triggerRect.top - menuRect.height - gap;
      const expandedAnchorTop = triggerRect.bottom + gap;
      const top = isCollapsed ? collapsedAnchorTop : expandedAnchorTop;
      const unclampedLeft = Math.min(
        triggerRect.left,
        window.innerWidth - menuRect.width - margin,
      );
      const left = Math.max(margin, unclampedLeft);
      const maxTop = window.innerHeight - menuRect.height - margin;

      setPosition({
        left,
        top: Math.max(margin, Math.min(top, maxTop)),
      });
    },
    [isCollapsed],
  );

  useLayoutEffect(() => {
    if (!terminalFilterMenuOpen || !portalReady) {
      return;
    }

    const update = () => positionDropdownMenu(terminalFilterTriggerRef.current, terminalFilterMenuRef.current, setTerminalFilterMenuPosition);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [portalReady, positionDropdownMenu, terminalFilterMenuOpen]);

  useLayoutEffect(() => {
    if (!interactiveTerminalMenuOpen || !portalReady) {
      return;
    }

    const update = () => positionDropdownMenu(interactiveTerminalTriggerRef.current, interactiveTerminalMenuRef.current, setInteractiveTerminalMenuPosition);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [interactiveTerminalMenuOpen, portalReady, positionDropdownMenu]);

  const startResize = (mouseDownEvent: React.MouseEvent) => {
    if (isCollapsed) return;
    mouseDownEvent.preventDefault();
    setIsResizing(true);
    const startY = mouseDownEvent.clientY;
    const startHeight = panelHeight;

    const doResize = (mouseMoveEvent: MouseEvent) => {
      const deltaY = mouseMoveEvent.clientY - startY;
      const newHeight = Math.max(150, Math.min(800, startHeight - deltaY));
      setPanelHeight(newHeight);
    };

    const stopResize = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", doResize);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("mousemove", doResize);
    window.addEventListener("mouseup", stopResize);
  };

  const handleDoubleClick = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
      return;
    }
    setPanelHeight(350);
  };

  const visibleCommands = useMemo(() => {
    const openCommandIdSet = new Set(openCommandIds);
    return commands.filter(
      (command) => openCommandIdSet.has(command.id) || Boolean(terminalContentByCommandId[command.id]) || runs[command.id],
    );
  }, [commands, openCommandIds, runs, terminalContentByCommandId]);

  const filteredVisibleCommands = useMemo(
    () => visibleCommands.filter((command) => matchesTerminalFilter(command, terminalFilter)),
    [terminalFilter, visibleCommands],
  );

  const selectedCommand = filteredVisibleCommands.find((command) => command.id === activeCommandId) ?? filteredVisibleCommands[0] ?? null;
  const selectedCommandId = selectedCommand?.id ?? null;
  const selectedProject = projects.find((project) => project.id === selectedCommand?.project_id) ?? null;
  const selectedTerminalContent = selectedCommandId ? terminalContentByCommandId[selectedCommandId] ?? "" : "";
  const resolvedTerminalFontSize = Number.parseInt(terminalFontSize, 10) || 13;
  const selectedCommandPorts = selectedCommand ? commandPorts(selectedCommand) : [];
  const handleSelectedTerminalInput = useCallback(
    (data: string) => {
      if (!selectedCommand || selectedCommand.runtime_mode !== "internal_interactive") {
        return;
      }
      onTerminalInput(selectedCommand.id, data);
    },
    [onTerminalInput, selectedCommand],
  );
  const handleSelectedTerminalResize = useCallback(
    (cols: number, rows: number) => {
      if (!selectedCommand) {
        return;
      }
      onTerminalResize(selectedCommand.id, cols, rows);
    },
    [onTerminalResize, selectedCommand],
  );

  useEffect(() => {
    if (selectedCommandId && selectedCommandId !== activeCommandId) {
      onActiveCommandChange(selectedCommandId);
    }
  }, [activeCommandId, onActiveCommandChange, selectedCommandId]);

  // Auto-collapse when there are no terminal tabs; expand when the first tab appears.
  useEffect(() => {
    const previousCount = previousVisibleCountRef.current;
    const nextCount = filteredVisibleCommands.length;

    if (nextCount === 0 && previousCount !== 0) {
      setIsCollapsed(true);
    } else if (nextCount > 0 && previousCount === 0) {
      setIsCollapsed(false);
    } else if (nextCount === 0 && previousCount === 0) {
      setIsCollapsed(true);
    }

    previousVisibleCountRef.current = nextCount;
  }, [filteredVisibleCommands.length]);

  useEffect(() => {
    if (selectedCommandId || terminalFilter === "all") {
      return;
    }

    const hasMatchingVisibleCommand = visibleCommands.some((command) => matchesTerminalFilter(command, terminalFilter));
    if (!hasMatchingVisibleCommand) {
      setTerminalFilter("all");
    }
  }, [selectedCommandId, terminalFilter, visibleCommands]);

  const handleAddInteractiveTerminal = useCallback(() => {
    const project = projects.find((item) => item.id === selectedCommand?.project_id) ?? projects[0];
    if (!project) {
      return;
    }

    onOpenAdHocInteractiveTerminal(project, selectedInteractiveTerminalKind);
    setInteractiveTerminalMenuOpen(false);
  }, [onOpenAdHocInteractiveTerminal, projects, selectedCommand, selectedInteractiveTerminalKind]);

  const collapseToggle = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7 rounded-[4px] border border-transparent p-0 text-[var(--vscode-icon)] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground"
      onClick={() => setIsCollapsed((prev) => !prev)}
      aria-label={isCollapsed ? "Restore terminal output" : "Minimize terminal output"}
    >
      {isCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
    </Button>
  );

  const canCreateInteractiveTerminal = Boolean(selectedCommand?.project_id ?? projects[0]?.id);
  const canCloseAllTerminals = visibleCommands.length > 0;
  const headerControls = (
    <div className="flex shrink-0 items-center gap-0.5 pr-1">
      {activePanelView === "terminal" ? (
        <>
          <div className="relative" data-terminal-filter-menu="" ref={terminalFilterTriggerRef}>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                terminalDropdownTriggerClassName,
                "min-w-[112px] justify-between",
                terminalFilterMenuOpen && "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)] text-foreground",
              )}
              onClick={() => setTerminalFilterMenuOpen((current) => !current)}
              aria-label="Filter terminal type"
              data-state={terminalFilterMenuOpen ? "open" : "closed"}
            >
              <span>{terminalFilterLabel(terminalFilter)}</span>
              <ChevronDown size={13} />
            </Button>
            {terminalFilterMenuOpen ? (
              portalReady ? createPortal(
                <div
                  ref={terminalFilterMenuRef}
                  className={cn(terminalDropdownMenuClassName, "min-w-[150px]")}
                  style={terminalFilterMenuPosition}
                  data-terminal-filter-menu=""
                >
                  {[
                    { value: "all", label: "All terminals" },
                    { value: "internal_interactive", label: "Interactive" },
                    { value: "internal_headless", label: "Headless" },
                    { value: "external_terminal", label: "External" },
                  ].map((option) => {
                    const selected = terminalFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setTerminalFilter(option.value as TerminalFilter);
                          setTerminalFilterMenuOpen(false);
                        }}
                        className={cn(
                          terminalDropdownItemClassName,
                          selected
                            ? "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)]"
                            : "",
                        )}
                      >
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>,
                document.body,
              ) : null
            ) : null}
          </div>
          <div className="mx-1 h-4 w-px bg-[var(--vscode-border)]" aria-hidden="true" />
          <div className="relative flex items-center" data-interactive-terminal-menu="" ref={interactiveTerminalTriggerRef}>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                terminalDropdownTriggerClassName,
                "min-w-0 rounded-r-none border-r-0 px-1.5",
                interactiveTerminalMenuOpen && "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)] text-foreground",
              )}
              disabled={!canCreateInteractiveTerminal}
              onClick={handleAddInteractiveTerminal}
              aria-label="Open new interactive terminal"
            >
              <Plus size={13} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                terminalDropdownTriggerClassName,
                "h-7 w-6 rounded-l-none px-0",
                interactiveTerminalMenuOpen && "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)] text-foreground",
              )}
              disabled={!canCreateInteractiveTerminal}
              onClick={() => setInteractiveTerminalMenuOpen((current) => !current)}
              aria-label="Choose interactive terminal kind"
              data-state={interactiveTerminalMenuOpen ? "open" : "closed"}
            >
              <ChevronDown size={13} />
            </Button>
            {interactiveTerminalMenuOpen ? (
              portalReady ? createPortal(
                <div
                  ref={interactiveTerminalMenuRef}
                  className={cn(terminalDropdownMenuClassName, "min-w-[140px]")}
                  style={interactiveTerminalMenuPosition}
                  data-interactive-terminal-menu=""
                >
                  {interactiveTerminalOptions.map((option) => {
                    const selected = option.id === selectedInteractiveTerminalKind;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedInteractiveTerminalKind(option.id);
                          setInteractiveTerminalMenuOpen(false);
                        }}
                        className={cn(
                          terminalDropdownItemClassName,
                          selected
                            ? "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)]"
                            : "",
                        )}
                      >
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>,
                document.body,
              ) : null
            ) : null}
          </div>
          <Tooltip content={`Current interactive terminal: ${interactiveTerminalLabel(selectedInteractiveTerminalKind)}`}>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-[4px] border border-transparent text-[var(--vscode-icon)] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground"
              disabled={!selectedCommandId}
              onClick={() => selectedCommandId && onClear(selectedCommandId)}
              aria-label="Clear current terminal"
            >
              <BrushCleaning size={14} />
            </Button>
          </Tooltip>
          <Tooltip content="Close all terminal tabs">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-[4px] border border-transparent text-[var(--vscode-icon)] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground"
              disabled={!canCloseAllTerminals}
              onClick={() => onRequestCloseAllTabs(visibleCommands.map((command) => command.id))}
              aria-label="Close all terminal tabs"
            >
              <X size={14} />
            </Button>
          </Tooltip>
        </>
      ) : null}
      {collapseToggle}
    </div>
  );

  return (
    <aside
      className={cn(
        "log-panel relative flex w-full min-w-0 flex-col overflow-hidden rounded-none border-0 bg-[var(--log-panel-bg)]",
        isCollapsed
          ? "h-auto min-h-0 shrink-0"
          : "h-[var(--log-panel-height)] min-h-[220px] xl:h-full xl:min-h-0",
      )}
      style={
        isCollapsed
          ? undefined
          : ({ "--log-panel-height": `${panelHeight}px` } as CSSProperties)
      }
    >
      {!isCollapsed ? (
        <div
          className={`absolute left-0 right-0 top-[-4px] z-50 h-2 cursor-ns-resize bg-transparent transition-colors ${isResizing ? "bg-primary/40" : "hover:bg-primary/40"}`}
          onMouseDown={startResize}
          onDoubleClick={handleDoubleClick}
          title="Drag to resize, double click to reset"
        />
      ) : null}

      {filteredVisibleCommands.length === 0 ? (
        <>
          <div className="flex min-h-9 items-center justify-between gap-3 border-b border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-2 py-0.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {[
                { id: "terminal", label: "Terminal" },
                { id: "environments", label: "Environments" },
              ].map((view) => {
                const active = activePanelView === view.id;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setActivePanelView(view.id as "terminal" | "environments")}
                    className={cn(
                      "inline-flex h-8 items-center border-b border-transparent px-2.5 text-[11.5px] text-[var(--vscode-foreground)]/72 transition-[background-color,color,border-color] hover:text-foreground",
                      active && "border-primary bg-transparent text-foreground",
                    )}
                  >
                    {view.label}
                  </button>
                );
              })}
            </div>
            {headerControls}
          </div>
          {!isCollapsed ? (
            activePanelView === "terminal" ? (
              <div className="log-terminal flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--terminal-bg)]" ref={terminalRef}>
                <XtermTerminal
                  content={"Run a command to open its terminal tab.\r\n"}
                  fontFamily={terminalFontFamily}
                  fontSize={resolvedTerminalFontSize}
                  theme={theme}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--vscode-editor)] px-5 py-6 text-[12px] text-muted-foreground">
                Run a command to inspect its environment details.
              </div>
            )
          ) : null}
        </>
      ) : (
        <div className={cn("flex min-h-0 flex-col", !isCollapsed && "flex-1")}>
          <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-b border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-2 py-0.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {[
                { id: "terminal", label: "Terminal" },
                { id: "environments", label: "Environments" },
              ].map((view) => {
                const active = activePanelView === view.id;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setActivePanelView(view.id as "terminal" | "environments")}
                    className={cn(
                      "inline-flex h-8 items-center border-b border-transparent px-2.5 text-[11.5px] text-[var(--vscode-foreground)]/72 transition-[background-color,color,border-color] hover:text-foreground",
                      active && "border-primary bg-transparent text-foreground",
                    )}
                  >
                    {view.label}
                  </button>
                );
              })}
            </div>
            {headerControls}
          </div>

          {!isCollapsed && selectedCommand ? (
            activePanelView === "terminal" ? (
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px] overflow-hidden bg-[var(--terminal-bg)]">
                <div className="flex min-h-0 flex-1 border-r border-[var(--vscode-border)] bg-[var(--terminal-bg)]">
                  <div className="log-terminal flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--terminal-bg)]" key={selectedCommand.id} ref={terminalRef}>
                    <XtermTerminal
                      content={selectedTerminalContent || "Waiting for output...\r\n"}
                      fontFamily={terminalFontFamily}
                      fontSize={resolvedTerminalFontSize}
                      theme={theme}
                      onData={selectedCommand.runtime_mode === "internal_interactive" ? handleSelectedTerminalInput : undefined}
                      onSizeChange={handleSelectedTerminalResize}
                      readOnly={selectedCommand.runtime_mode !== "internal_interactive"}
                    />
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden border-l-0 bg-[var(--vscode-panel)]">
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--vscode-panel)] py-0.5">
                    {filteredVisibleCommands.map((command) => {
                      const isActive = selectedCommandId === command.id;
                      const project = projects.find((item) => item.id === command.project_id);
                      const tabLabel = `${command.name} [${project?.name ?? "Unknown project"}]`;
                      const tooltipLabel = `${tabLabel} | ${terminalFilterLabel(command.runtime_mode as TerminalFilter)}`;

                      return (
                        <Tooltip key={command.id} content={tooltipLabel} side="left" wrapperClassName="block">
                          <button
                            type="button"
                            onClick={() => onActiveCommandChange(command.id)}
                            className={cn(
                              "terminal-side-item group relative flex w-full items-center gap-1.5 border-y border-transparent px-2 py-1 text-left text-[var(--vscode-foreground)]/84 transition-[background-color,border-color,color]",
                              "hover:bg-[var(--vscode-list-hover)] hover:text-foreground",
                              isActive && "border-[var(--vscode-border)] bg-[var(--vscode-list-selected)] text-foreground",
                            )}
                          >
                            {isActive ? <span className="absolute inset-y-1 left-0 w-[2px] rounded-r-full bg-primary" /> : null}
                            <div className="relative shrink-0">
                              <EntityAvatar name={command.name} path={command.avatar_path} className="h-[18px] w-[18px] rounded-[4px]" iconSize={11.5} />
                              <span
                                className={cn(
                                  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[var(--vscode-panel)] bg-[var(--vscode-foreground)]/24",
                                  runs[command.id]?.status === "running" && "bg-success",
                                )}
                              />
                            </div>
                            <span className="min-w-0 flex-1 truncate pr-1 text-[11px] leading-none">{tabLabel}</span>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className={cn(
                                "terminal-side-close h-5 w-5 shrink-0 rounded-[4px] border border-transparent p-0 text-[var(--vscode-icon)] opacity-0 transition-[opacity,background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground",
                                isActive ? "opacity-100 text-foreground/70" : "group-hover:opacity-100",
                              )}
                              onClick={(event) => {
                                event.stopPropagation();
                                onCloseTab(command.id);
                              }}
                              aria-label={`Close ${command.name} log tab`}
                            >
                              <X size={12} />
                            </Button>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--vscode-editor)] p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  {[
                    { label: "Project", value: selectedProject?.name ?? "Unknown project", icon: <FolderOpen size={14} /> },
                    { label: "Working directory", value: selectedProject?.path ?? "Unavailable" },
                    { label: "Runtime mode", value: runtimeModeLabel(selectedCommand.runtime_mode) },
                    { label: "Interactivity", value: selectedCommand.runtime_mode === "internal_interactive" ? "Interactive terminal" : "Read-only output" },
                    { label: "Run status", value: runs[selectedCommand.id]?.status ?? "ready" },
                    { label: "Ports", value: selectedCommandPorts.length > 0 ? selectedCommandPorts.join(", ") : "No tracked ports" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-3.5 py-3">
                      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/52">
                        {item.icon ?? null}
                        <span>{item.label}</span>
                      </div>
                      <div className="break-words font-mono text-[12px] text-foreground">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)]">
                  <div className="border-b border-[var(--vscode-border)] px-3.5 py-2 text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/52">
                    Command script
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-[12px] leading-6 text-foreground">
                    {normalizeCommandScript(selectedCommand.script)}
                  </pre>
                </div>
              </div>
            )
          ) : null}
        </div>
      )}
    </aside>
  );
}


