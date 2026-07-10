import { ActionSwapButton } from "./motion/action-swap";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
      className={`draggable-card command-card-shell ${isRunning ? "running" : ""} ${run?.status === "failed" ? "failed" : ""}`}
    >
      <CardHeader className="command-card-header">
        <div className="title-cluster">
          <EntityAvatar name={command.name} path={command.avatar_path} />
          <div className="command-card-title-block">
            <h3 className="command-card-title">{command.name}</h3>
            <div className="command-card-meta">
              <Badge variant={badgeVariant}>{run?.status ?? "ready"}</Badge>
              {Boolean(command.run_in_external_terminal) && (
                <Badge variant="muted" title="Runs in external terminal">
                  External
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="icon-menu command-card-menu">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit command">
            <Pencil size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Delete command">
            <Trash2 size={16} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="command-card-body">
        {ports.length > 0 && (
          <div className="port-list command-card-ports">
            {ports.map((port) => (
              <Badge key={port} variant="muted">
                :{port}
              </Badge>
            ))}
          </div>
        )}
        <pre className="script-preview command-card-script">{command.script}</pre>
        <div className="card-actions command-card-actions">
          <ActionSwapButton
            size="sm"
            variant={isRunning || isStopping ? "outline" : "primary"}
            animation="blur"
            cycle={false}
            disabled={isStopping}
            className={isRunning || isStopping ? "btn-stop border-destructive text-destructive hover:bg-destructive/10" : undefined}
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
            <Button size="sm" variant="secondary" onClick={onRestart} disabled={isRestarting}>
              {isRestarting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <RotateCcw size={14} />
                  Rerun
                </>
              )}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onKillPorts} disabled={ports.length === 0 || isScanningPorts}>
            {isScanningPorts ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Trash2 size={14} />
                Kill ports
              </>
            )}
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenLogs}>
            <Terminal size={14} />
            Logs
          </Button>
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
    <aside className="log-panel" style={{ height: panelHeight }}>
      <div
        className={`terminal-resize-handle ${isResizing ? "active" : ""}`}
        onMouseDown={startResize}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize, double click to reset"
      />
      {visibleCommands.length === 0 ? (
        <>
          <div className="log-header">
            <div className="log-header-copy">
              <h3>Terminal Output</h3>
              <p>No command is selected yet</p>
            </div>
          </div>
          <div className="log-terminal" ref={terminalRef}>
            <TerminalUi colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark} height="100%" name="Output" prompt="" TopButtonsPanel={() => null}>
              <TerminalOutput>
                <span className="terminal-muted">Run a command to open its terminal tab.</span>
              </TerminalOutput>
            </TerminalUi>
          </div>
        </>
      ) : (
        <Tabs
          className="terminal-tabs"
          value={String(selectedCommandId)}
          onValueChange={(value) => onActiveCommandChange(Number(value))}
        >
          <div className="log-header">
            <TabsList className="terminal-tabs-list">
              {visibleCommands.map((command) => (
                <div className="terminal-tab-chip" key={command.id}>
                  <TabsTrigger className="terminal-tabs-trigger" value={String(command.id)}>
                    <span className="terminal-tab-label">{command.name}</span>
                    {runs[command.id]?.status === "running" && <span className="terminal-tab-status" />}
                  </TabsTrigger>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="close-tab-btn"
                    onClick={() => onCloseTab(command.id)}
                    aria-label={`Close ${command.name} log tab`}
                    title="Close tab and stop process"
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </TabsList>
            <div className="log-actions">
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
            <TabsContent className="terminal-tabs-content" value={String(selectedCommand.id)}>
              <div className="log-terminal" key={selectedCommand.id} ref={terminalRef}>
                <TerminalUi
                  colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark}
                  height="100%"
                  name={selectedCommand.name}
                  prompt=""
                  TopButtonsPanel={() => null}
                >
                  {selectedLogs.length === 0 ? (
                    <TerminalOutput>
                      <span className="terminal-muted">Waiting for output...</span>
                    </TerminalOutput>
                  ) : (
                    selectedLogs.map((line) => (
                      <TerminalOutput key={line.id}>
                        <span className={`terminal-stream ${line.stream}`}>
                          {showLogsTimestamp && <span className="terminal-timestamp">[{line.timestamp}]</span>}
                          {showStreamName && <span className="terminal-stream-name">[{line.stream}] </span>}
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

