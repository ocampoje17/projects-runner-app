import { ActionSwapButton } from "./motion/action-swap";
import { Tooltip } from "./motion/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { StatefulButton } from "./ui/stateful-button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EntityAvatar } from "./entity-avatar";
import { commandPorts } from "../lib/command-utils";
import type { ProjectCommand } from "../lib/api";
import { Loader2, Pencil, Play, RotateCcw, Square, Terminal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import TerminalUi, { ColorMode, TerminalOutput } from "react-terminal-ui";

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

export function CommandCard({
  command,
  onDelete,
  onEdit,
  onKillPorts,
  onRestart,
  onRun,
  onStop,
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
  onOpenLogs: () => void;
  run?: RunState;
  isStopping?: boolean;
  isRestarting?: boolean;
  isScanningPorts?: boolean;
}) {
  const isRunning = run?.status === "running";
  const badgeVariant = isRunning ? "success" : run?.status === "failed" ? "danger" : "muted";
  const ports = commandPorts(command);

  return (
    <Card
      className={`overflow-hidden rounded-[10px] border border-app-border bg-card shadow-app-card transition-all ${isRunning ? "command-card-running" : ""} ${run?.status === "failed" ? "command-card-failed" : "hover:-translate-y-px hover:border-primary/30 hover:shadow-app-card-hover"}`}
    >
      <CardHeader className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <EntityAvatar name={command.name} path={command.avatar_path} />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-app-title">{command.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={badgeVariant}>{run?.status ?? "ready"}</Badge>
              {Boolean(command.run_in_external_terminal) && (
                <Badge variant="muted" title="Runs in external terminal">
                  External
                </Badge>
              )}
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
        <pre className="overflow-x-auto rounded-[8px] border border-app-border/70 bg-[var(--script-preview-bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--script-preview-color)]">{command.script}</pre>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ActionSwapButton
            size="sm"
            variant={isRunning || isStopping ? "outline" : "primary"}
            animation="blur"
            cycle={false}
            disabled={isStopping}
            className={isRunning || isStopping ? "min-w-[95px] justify-center border-destructive text-destructive hover:bg-destructive/10" : undefined}
            value={isStopping ? "stopping" : isRunning ? "stop" : "run"}
            onClick={() => {
              if (isStopping) return;
              if (isRunning) onStop();
              else onRun();
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
          {isRunning && (
            <ActionSwapButton
              size="sm"
              variant="secondary"
              animation="blur"
              cycle={false}
              disabled={isRestarting}
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
          )}
          <StatefulButton
            size="sm"
            variant="secondary"
            onClick={onKillPorts}
            disabled={ports.length === 0}
            state={isScanningPorts ? "loading" : "idle"}
            icon={<Trash2 size={14} />}
            loadingText="Scanning..."
          >
            Kill ports
          </StatefulButton>
          <Tooltip content="Open terminal logs">
            <Button size="sm" variant="secondary" onClick={onOpenLogs}>
              <Terminal size={14} />
              Logs
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
  logs,
  openCommandIds,
  onActiveCommandChange,
  onClear,
  onCloseTab,
  runs,
  theme,
  showLogsTimestamp = false,
  showStreamName = true,
}: {
  activeCommandId: number | null;
  commands: ProjectCommand[];
  logs: LogLine[];
  openCommandIds: number[];
  onActiveCommandChange: (commandId: number) => void;
  onClear: (commandId: number) => void;
  onCloseTab: (commandId: number) => void;
  runs: Record<number, RunState>;
  theme: "light" | "dark";
  showLogsTimestamp?: boolean;
  showStreamName?: boolean;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    localStorage.setItem("logPanelHeight", String(panelHeight));
  }, [panelHeight]);

  const startResize = (mouseDownEvent: React.MouseEvent) => {
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
    setPanelHeight(350);
  };

  const visibleCommands = useMemo(() => {
    const commandIdsWithLogs = new Set(logs.map((line) => line.commandId));
    const openCommandIdSet = new Set(openCommandIds);
    return commands.filter(
      (command) => openCommandIdSet.has(command.id) || commandIdsWithLogs.has(command.id) || runs[command.id],
    );
  }, [commands, logs, openCommandIds, runs]);

  const selectedCommand = visibleCommands.find((command) => command.id === activeCommandId) ?? visibleCommands[0] ?? null;
  const selectedCommandId = selectedCommand?.id ?? null;
  const selectedLogs = useMemo(
    () => logs.filter((line) => line.commandId === selectedCommandId).slice(-500),
    [logs, selectedCommandId],
  );

  useEffect(() => {
    const terminalBody = terminalRef.current?.querySelector(".react-terminal");
    terminalBody?.scrollTo({ top: terminalBody.scrollHeight, behavior: "smooth" });
  }, [selectedLogs]);

  useEffect(() => {
    if (selectedCommandId && selectedCommandId !== activeCommandId) {
      onActiveCommandChange(selectedCommandId);
    }
  }, [activeCommandId, onActiveCommandChange, selectedCommandId]);

  return (
    <aside className="log-panel relative flex h-[320px] min-h-[200px] shrink-0 flex-col overflow-hidden rounded-[10px] border border-app-border bg-[var(--log-panel-bg)] shadow-app-card" style={{ height: panelHeight }}>
      <div
        className={`absolute left-0 right-0 top-[-4px] z-50 h-2 cursor-ns-resize bg-transparent transition-colors ${isResizing ? "bg-primary/40" : "hover:bg-primary/40"}`}
        onMouseDown={startResize}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize, double click to reset"
      />
      {visibleCommands.length === 0 ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-app-border bg-[var(--log-header-bg)] px-2.5 py-1">
            <div className="min-w-0 px-1 py-1">
              <h3 className="text-[13px] font-semibold text-app-title">Terminal Output</h3>
              <p className="text-[11px] text-muted-foreground">No command is selected yet</p>
            </div>
          </div>
          <div className="log-terminal flex h-full min-h-0 flex-1 overflow-hidden bg-[#03050a]" ref={terminalRef}>
            <TerminalUi colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark} height="100%" name="Output" prompt="" TopButtonsPanel={() => null}>
              <TerminalOutput>
                <span className="terminal-muted text-muted-foreground">Run a command to open its terminal tab.</span>
              </TerminalOutput>
            </TerminalUi>
          </div>
        </>
      ) : (
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          value={String(selectedCommandId)}
          onValueChange={(value) => onActiveCommandChange(Number(value))}
        >
          <div className="flex items-center justify-between gap-3 border-b border-app-border bg-[var(--log-header-bg)] px-2.5 py-1">
            <TabsList className="flex min-h-8 items-center gap-1 overflow-x-auto border-0 bg-transparent p-0.5">
              {visibleCommands.map((command) => (
                <div className="inline-flex items-center gap-0.5" key={command.id}>
                  <TabsTrigger className="max-w-[170px] gap-2 rounded-[6px] border border-transparent px-2 text-[11.5px] data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-app-title" value={String(command.id)}>
                    <span className="truncate">{command.name}</span>
                    {runs[command.id]?.status === "running" && <span className="terminal-tab-status" />}
                  </TabsTrigger>
                  <Tooltip content="Close tab and stop process">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="ml-0.5 h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onCloseTab(command.id)}
                      aria-label={`Close ${command.name} log tab`}
                    >
                      <X size={12} />
                    </Button>
                  </Tooltip>
                </div>
              ))}
            </TabsList>
            <div className="flex items-center gap-1.5 pr-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedCommandId}
                onClick={() => selectedCommandId && onClear(selectedCommandId)}
              >
                Clear
              </Button>
            </div>
          </div>
          {selectedCommand && (
            <TabsContent className="m-0 flex h-full min-h-0 flex-1 overflow-hidden" value={String(selectedCommand.id)}>
              <div className="log-terminal flex h-full min-h-0 flex-1 overflow-hidden bg-[#03050a]" key={selectedCommand.id} ref={terminalRef}>
                <TerminalUi
                  colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark}
                  height="100%"
                  name={selectedCommand.name}
                  prompt=""
                  TopButtonsPanel={() => null}
                >
                  {selectedLogs.length === 0 ? (
                    <TerminalOutput>
                      <span className="terminal-muted text-muted-foreground">Waiting for output...</span>
                    </TerminalOutput>
                  ) : (
                    selectedLogs.map((line) => (
                      <TerminalOutput key={line.id}>
                        <span className={`terminal-stream font-inherit whitespace-inherit ${line.stream === "stdout" ? "text-emerald-200" : "text-rose-200"} ${line.stream}`}>
                          {showLogsTimestamp && <span className="mr-1 opacity-50">[{line.timestamp}]</span>}
                          {showStreamName && <span className="mr-1 opacity-70">[{line.stream}] </span>}
                          {line.line}
                        </span>
                      </TerminalOutput>
                    ))
                  )}
                </TerminalUi>
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </aside>
  );
}


