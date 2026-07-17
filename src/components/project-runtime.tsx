import { Tooltip } from "./motion/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EntityAvatar } from "./entity-avatar";
import { XtermTerminal } from "./xterm-terminal";
import { commandPorts, normalizeCommandScript, runtimeModeLabel } from "../lib/command-utils";
import type { Project, ProjectCommand } from "../lib/api";
import { BrushCleaning, FolderOpen, Keyboard, Loader2, Maximize2, Minimize2, Pencil, Play, RotateCcw, Square, Terminal, Trash2, X } from "lucide-react";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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

function runtimeModeBadgeLabel(command: ProjectCommand) {
  if (command.runtime_mode === "external_terminal") {
    return "External";
  }
  return null;
}

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
              {isScanningPorts ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
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
  runs: Record<number, RunState>;
  terminalContentByCommandId: Record<number, string>;
  terminalFontFamily: string;
  terminalFontSize: string;
  theme: "light" | "dark";
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const previousVisibleCountRef = useRef(0);
  const [activePanelView, setActivePanelView] = useState<"terminal" | "environments">("terminal");
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

  useEffect(() => {
    localStorage.setItem("logPanelHeight", String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    localStorage.setItem("logPanelCollapsed", String(isCollapsed));
  }, [isCollapsed]);

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

  const selectedCommand = visibleCommands.find((command) => command.id === activeCommandId) ?? visibleCommands[0] ?? null;
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
    const nextCount = visibleCommands.length;

    if (nextCount === 0 && previousCount !== 0) {
      setIsCollapsed(true);
    } else if (nextCount > 0 && previousCount === 0) {
      setIsCollapsed(false);
    } else if (nextCount === 0 && previousCount === 0) {
      setIsCollapsed(true);
    }

    previousVisibleCountRef.current = nextCount;
  }, [visibleCommands.length]);

  const collapseToggle = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
      onClick={() => setIsCollapsed((prev) => !prev)}
      aria-label={isCollapsed ? "Restore terminal output" : "Minimize terminal output"}
    >
      {isCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
    </Button>
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

      {visibleCommands.length === 0 ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-border)] bg-[var(--log-header-bg)] px-2.5 py-1">
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
                      "inline-flex h-8 items-center border border-transparent border-b-0 px-3 text-[12px] text-[var(--vscode-foreground)]/72 transition-[background-color,color,border-color] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
                      active && "bg-[var(--terminal-tabs-bg)] text-foreground border-[var(--vscode-border)]",
                    )}
                  >
                    {view.label}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pr-1">{collapseToggle}</div>
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
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--vscode-border)] bg-[var(--log-header-bg)] px-2.5 py-1">
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
                      "inline-flex h-8 items-center border border-transparent border-b-0 px-3 text-[12px] text-[var(--vscode-foreground)]/72 transition-[background-color,color,border-color] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
                      active && "bg-[var(--terminal-tabs-bg)] text-foreground border-[var(--vscode-border)]",
                    )}
                  >
                    {view.label}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pr-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                disabled={!selectedCommandId || activePanelView !== "terminal"}
                onClick={() => selectedCommandId && onClear(selectedCommandId)}
                aria-label="Clear current terminal"
              >
                <BrushCleaning size={14} />
              </Button>
              {collapseToggle}
            </div>
          </div>

          <Tabs
            className={cn("flex min-h-0 flex-col border-b border-[var(--vscode-border)] bg-[var(--vscode-tabs)]", !isCollapsed && activePanelView === "terminal" && "shrink-0")}
            value={String(selectedCommandId)}
            onValueChange={(value) => onActiveCommandChange(Number(value))}
            variant="underline"
          >
            <TabsList className="flex min-h-9 min-w-0 flex-1 items-center gap-0 overflow-x-auto overflow-y-hidden border-0 bg-transparent px-1 pt-1">
              {visibleCommands.map((command) => (
                <div
                  className={cn(
                    "terminal-tab-item inline-flex items-center gap-1 border border-transparent border-b-0 pr-1 transition-colors",
                    selectedCommandId === command.id && "terminal-tab-item-active border-[var(--vscode-border)] bg-[var(--terminal-tabs-bg)]",
                  )}
                  key={command.id}
                >
                  <TabsTrigger
                    className="terminal-tab-trigger max-w-[180px] gap-2 border-0 px-3 py-2 text-[12px] data-[state=active]:font-semibold data-[state=active]:text-foreground"
                    value={String(command.id)}
                  >
                    <span className="truncate">{command.name}</span>
                    {runs[command.id]?.status === "running" && <span className="terminal-tab-status" />}
                  </TabsTrigger>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "terminal-tab-close mr-0.5 h-6 w-6 rounded-[4px] p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                      selectedCommandId === command.id && "text-foreground/70 hover:text-destructive",
                    )}
                    onClick={() => onCloseTab(command.id)}
                    aria-label={`Close ${command.name} log tab`}
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </TabsList>
          </Tabs>

          {!isCollapsed && selectedCommand ? (
            activePanelView === "terminal" ? (
              <Tabs
                className="flex min-h-0 flex-1 flex-col"
                value={String(selectedCommandId)}
                onValueChange={(value) => onActiveCommandChange(Number(value))}
                variant="underline"
              >
                <TabsContent className="m-0 flex h-full min-h-0 flex-1 overflow-hidden" value={String(selectedCommand.id)}>
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
                </TabsContent>
              </Tabs>
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


