import { ActionSwapButton } from "./motion/action-swap";
import { Tooltip } from "./motion/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EntityAvatar } from "./entity-avatar";
import { XtermTerminal } from "./xterm-terminal";
import { commandPorts } from "../lib/command-utils";
import type { ProjectCommand } from "../lib/api";
import { BrushCleaning, Keyboard, Loader2, Maximize2, Minimize2, Pencil, Play, RotateCcw, Square, Terminal, Trash2, X } from "lucide-react";
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

  useEffect(() => () => {
    if (stopClickTimeout.current) clearTimeout(stopClickTimeout.current);
  }, []);
  const badgeVariant = isRunning ? "success" : run?.status === "failed" ? "danger" : "muted";
  const ports = commandPorts(command);

  return (
    <Card
      className={cn("self-start overflow-hidden transition-all", isRunning && "command-card-running", run?.status === "failed" ? "command-card-failed" : "hover:-translate-y-px hover:border-primary/30 hover:shadow-app-card-hover")}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <EntityAvatar name={command.name} path={command.avatar_path} />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-app-title">{command.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={badgeVariant}>{run?.status ?? "ready"}</Badge>
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
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit command">
              <Pencil size={16} />
            </Button>
          </Tooltip>
          <Tooltip content="Delete command">
            <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Delete command">
              <Trash2 size={16} />
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {ports.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {ports.map((port) => (
              <Badge key={port} variant="muted">
                :{port}
              </Badge>
            ))}
          </div>
        )}
        <pre className="max-h-[calc(1.625em*5+1rem)] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-[14px] border border-border bg-[var(--script-preview-bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--script-preview-color)]">{command.script}</pre>
        <div className="mt-2 flex flex-nowrap items-center gap-1">
          <Tooltip content={isStopping ? "Stopping" : isRunning ? "Stop - double-click to force stop" : "Run"}>
            <ActionSwapButton
              size="icon"
              variant={isRunning || isStopping ? "outline" : "primary"}
              animation="blur"
              cycle={false}
              disabled={isStopping}
              className={cn(
                "h-8 w-8 shrink-0",
                (isRunning || isStopping) && "border-destructive text-destructive hover:bg-destructive/10",
              )}
              value={isStopping ? "stopping" : isRunning ? "stop" : "run"}
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
              items={[
                { id: "run", label: "Run", icon: <Play size={14} />, ariaLabel: `Run ${command.name}` },
                { id: "stop", label: "Stop", icon: <Square size={14} />, ariaLabel: `Stop ${command.name}` },
                {
                  id: "stopping",
                  label: "Stopping",
                  icon: <Loader2 size={14} className="animate-spin" />,
                  ariaLabel: `Stopping ${command.name}`,
                },
              ]}
            />
          </Tooltip>
          {isRunning && (
            <Tooltip content={isRestarting ? "Restarting" : "Rerun"}>
              <ActionSwapButton
                size="icon"
                variant="secondary"
                animation="blur"
                cycle={false}
                disabled={isRestarting}
                className="h-8 w-8 shrink-0"
                value={isRestarting ? "restarting" : "restart"}
                onClick={() => {
                  if (!isRestarting) onRestart();
                }}
                items={[
                  { id: "restart", label: "Rerun", icon: <RotateCcw size={14} />, ariaLabel: `Rerun ${command.name}` },
                  {
                    id: "restarting",
                    label: "Restarting",
                    icon: <Loader2 size={14} className="animate-spin" />,
                    ariaLabel: `Restarting ${command.name}`,
                  },
                ]}
              />
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
              {isScanningPorts ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </Button>
          </Tooltip>
          <Tooltip content="Logs">
            <Button size="icon" variant="secondary" onClick={onOpenLogs} aria-label="Logs" className="h-8 w-8 shrink-0">
              <Terminal size={14} />
            </Button>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

export function LogPanel({
  activeCommandId,
  commands,
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
  const selectedTerminalContent = selectedCommandId ? terminalContentByCommandId[selectedCommandId] ?? "" : "";
  const resolvedTerminalFontSize = Number.parseInt(terminalFontSize, 10) || 13;
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
        "log-panel relative flex w-full min-w-0 flex-col overflow-hidden rounded-[18px] border border-border bg-[var(--log-panel-bg)] shadow-app-card",
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
          <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--log-header-bg)] px-2.5 py-1">
            <div className="min-w-0 px-1 py-1">
              <h3 className="text-[13px] font-semibold text-app-title">Terminal Output</h3>
              <p className="text-[11px] text-muted-foreground">No command is selected yet</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pr-1">{collapseToggle}</div>
          </div>
          {!isCollapsed ? (
            <div className="log-terminal flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--terminal-bg)]" ref={terminalRef}>
              <XtermTerminal
                content={"Run a command to open its terminal tab.\r\n"}
                fontFamily={terminalFontFamily}
                fontSize={resolvedTerminalFontSize}
                theme={theme}
              />
            </div>
          ) : null}
        </>
      ) : (
        <Tabs
          className={cn("flex min-h-0 flex-col", !isCollapsed && "flex-1")}
          value={String(selectedCommandId)}
          onValueChange={(value) => onActiveCommandChange(Number(value))}
          variant="underline"
        >
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-[var(--log-header-bg)] px-2.5 py-1">
            <TabsList className="flex min-h-9 min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden border-0 bg-transparent p-0">
              {visibleCommands.map((command) => (
                <div
                  className={cn(
                    "terminal-tab-item inline-flex items-center gap-1 rounded-t-[12px] border border-transparent border-b-0 pr-1 transition-colors",
                    selectedCommandId === command.id && "terminal-tab-item-active border-border/80 bg-[var(--terminal-tabs-bg)] shadow-sm",
                  )}
                  key={command.id}
                >
                  <TabsTrigger
                    className="terminal-tab-trigger max-w-[180px] gap-2 rounded-t-[12px] pl-3 pr-2 text-[12px] data-[state=active]:font-semibold data-[state=active]:text-foreground"
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
                      "terminal-tab-close mr-0.5 h-6 w-6 rounded-full p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
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
            <div className="flex shrink-0 items-center gap-1.5 pr-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                disabled={!selectedCommandId}
                onClick={() => selectedCommandId && onClear(selectedCommandId)}
                aria-label="Clear current terminal"
              >
                <BrushCleaning size={14} />
              </Button>
              {collapseToggle}
            </div>
          </div>
          {!isCollapsed && selectedCommand ? (
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
          ) : null}
        </Tabs>
      )}
    </aside>
  );
}


