import { listen } from "@tauri-apps/api/event";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  isDesktopRuntime,
  type InteractiveSession,
  type InteractiveSessionDataPayload,
  type InteractiveSessionErrorPayload,
  type InteractiveSessionExitedPayload,
  type PortProcess,
  type ProjectCommand,
  type RunFinishedPayload,
  type RunOutputPayload,
  type RunStartedPayload,
} from "../lib/api";
import { commandPorts } from "../lib/command-utils";
import type { LogLine, RunState } from "../components/project-runtime";

const ANSI_ESCAPE_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cleanTerminalLine(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}

const DEFAULT_INTERACTIVE_COLS = 120;
const DEFAULT_INTERACTIVE_ROWS = 32;

export function useCommandRuntime({
  autoClearLogs,
  showLogsTimestamp,
  showStreamName,
  onError,
}: {
  autoClearLogs: boolean;
  showLogsTimestamp: boolean;
  showStreamName: boolean;
  onError: (error: unknown) => void;
}) {
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [terminalContentByCommandId, setTerminalContentByCommandId] = useState<Record<number, string>>({});
  const [interactiveSessionsByCommandId, setInteractiveSessionsByCommandId] = useState<Record<number, InteractiveSession>>({});
  const [interactiveSizesByCommandId, setInteractiveSizesByCommandId] = useState<Record<number, { cols: number; rows: number }>>({});
  const [openLogCommandIds, setOpenLogCommandIds] = useState<number[]>([]);
  const [activeLogCommandId, setActiveLogCommandId] = useState<number | null>(null);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<number>>(new Set());
  const [restartPendingCommandIds, setRestartPendingCommandIds] = useState<number[]>([]);
  const [scanningCommandId, setScanningCommandId] = useState<number | null>(null);
  const [killPortsCommand, setKillPortsCommand] = useState<ProjectCommand | null>(null);
  const [portProcesses, setPortProcesses] = useState<PortProcess[]>([]);
  const [killPortsDialogOpen, setKillPortsDialogOpen] = useState(false);
  const [killingPorts, setKillingPorts] = useState(false);

  function formatHeadlessTerminalLine(stream: "stdout" | "stderr", line: string, timestamp: string) {
    const prefix = [
      showLogsTimestamp ? `[${timestamp}]` : "",
      showStreamName ? `[${stream}]` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return prefix ? `${prefix} ${line}` : line;
  }

  const runMutation = useMutation({
    mutationFn: api.runCommand,
    onError: (error) => onErrorRef.current(error),
  });

  const stopMutation = useMutation({
    mutationFn: api.stopCommand,
    onMutate: (runId) => {
      setStoppingRunIds((prev) => {
        const next = new Set(prev);
        next.add(runId);
        return next;
      });
    },
    onSettled: (_, __, runId) => {
      setStoppingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    },
    onSuccess: (_, runId) => {
      setRuns((current) => {
        const entry = Object.values(current).find((run) => run.runId === runId);
        if (!entry) {
          return current;
        }
        return {
          ...current,
          [entry.commandId]: {
            ...entry,
            status: "stopped",
            endedAt: new Date().toISOString(),
          },
        };
      });
    },
    onError: (error) => onErrorRef.current(error),
  });

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    const unlisteners = [
      listen<RunStartedPayload>("command://started", (event) => {
        setRuns((current) => ({
          ...current,
          [event.payload.command_id]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status: "running",
            startedAt: event.payload.started_at,
          },
        }));
        setOpenLogCommandIds((current) =>
          current.includes(event.payload.command_id) ? current : [...current, event.payload.command_id],
        );
        setActiveLogCommandId(event.payload.command_id);
      }),
      listen<RunOutputPayload>("command://stdout", (event) => {
        const cleanedLine = cleanTerminalLine(event.payload.line);
        const timestamp = new Date().toLocaleTimeString();
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-out-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stdout",
            line: cleanedLine,
            timestamp,
          },
        ]);
        setTerminalContentByCommandId((current) => ({
          ...current,
          [event.payload.command_id]: `${current[event.payload.command_id] ?? ""}${formatHeadlessTerminalLine("stdout", cleanedLine, timestamp)}\r\n`,
        }));
      }),
      listen<RunOutputPayload>("command://stderr", (event) => {
        const cleanedLine = cleanTerminalLine(event.payload.line);
        const timestamp = new Date().toLocaleTimeString();
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-err-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stderr",
            line: cleanedLine,
            timestamp,
          },
        ]);
        setTerminalContentByCommandId((current) => ({
          ...current,
          [event.payload.command_id]: `${current[event.payload.command_id] ?? ""}${formatHeadlessTerminalLine("stderr", cleanedLine, timestamp)}\r\n`,
        }));
      }),
      listen<RunFinishedPayload>("command://finished", (event) => {
        setRuns((current) => ({
          ...current,
          [event.payload.command_id]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status:
              event.payload.status === "exited"
                ? "exited"
                : event.payload.status === "stopped"
                  ? "stopped"
                  : "failed",
            startedAt: current[event.payload.command_id]?.startedAt ?? event.payload.ended_at,
            endedAt: event.payload.ended_at,
            exitCode: event.payload.exit_code,
          },
        }));

        setRestartPendingCommandIds((current) => {
          if (!current.includes(event.payload.command_id)) {
            return current;
          }

          if (autoClearLogs) {
            setLogs((lines) => lines.filter((line) => line.commandId !== event.payload.command_id));
            setTerminalContentByCommandId((terminalContent) => ({
              ...terminalContent,
              [event.payload.command_id]: "",
            }));
          }
          void api.runCommand(event.payload.command_id).catch(onErrorRef.current);
          return current.filter((id) => id !== event.payload.command_id);
        });
      }),
      listen<InteractiveSession>("pty://started", (event) => {
        setInteractiveSessionsByCommandId((current) => ({
          ...current,
          [event.payload.command_id]: event.payload,
        }));
        setInteractiveSizesByCommandId((current) => ({
          ...current,
          [event.payload.command_id]: {
            cols: event.payload.cols,
            rows: event.payload.rows,
          },
        }));
        setOpenLogCommandIds((current) =>
          current.includes(event.payload.command_id) ? current : [...current, event.payload.command_id],
        );
        setActiveLogCommandId(event.payload.command_id);
      }),
      listen<InteractiveSessionDataPayload>("pty://data", (event) => {
        setTerminalContentByCommandId((current) => ({
          ...current,
          [event.payload.command_id]: `${current[event.payload.command_id] ?? ""}${event.payload.data}`,
        }));
      }),
      listen<InteractiveSessionExitedPayload>("pty://exit", (event) => {
        setInteractiveSessionsByCommandId((current) => {
          const next = { ...current };
          delete next[event.payload.command_id];
          return next;
        });
      }),
      listen<InteractiveSessionErrorPayload>("pty://error", (event) => {
        onErrorRef.current(new Error(event.payload.error));
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [autoClearLogs, showLogsTimestamp, showStreamName]);

  function openLogCommandTab(commandId: number) {
    setOpenLogCommandIds((current) => (current.includes(commandId) ? current : [...current, commandId]));
    setActiveLogCommandId(commandId);
  }

  async function startCommandRun(command: ProjectCommand) {
    const run = runs[command.id];
    if (run?.status === "running" || (run && stoppingRunIds.has(run.runId))) {
      return;
    }

    if (autoClearLogs) {
      setLogs((current) => current.filter((line) => line.commandId !== command.id));
      setTerminalContentByCommandId((current) => ({
        ...current,
        [command.id]: "",
      }));
    }

    openLogCommandTab(command.id);

    try {
      if (command.runtime_mode === "internal_interactive") {
        const size = interactiveSizesByCommandId[command.id] ?? {
          cols: DEFAULT_INTERACTIVE_COLS,
          rows: DEFAULT_INTERACTIVE_ROWS,
        };
        await api.startInteractiveCommand(command.id, size.cols, size.rows);
      } else {
        runMutation.mutate(command.id);
      }
    } catch (error) {
      onErrorRef.current(error);
    }
  }

  async function handleRestartCommand(command: ProjectCommand) {
    openLogCommandTab(command.id);
    setRestartPendingCommandIds((current) => (current.includes(command.id) ? current : [...current, command.id]));

    try {
      if (command.runtime_mode === "internal_interactive") {
        const size = interactiveSizesByCommandId[command.id] ?? {
          cols: DEFAULT_INTERACTIVE_COLS,
          rows: DEFAULT_INTERACTIVE_ROWS,
        };
        if (autoClearLogs) {
          setTerminalContentByCommandId((current) => ({ ...current, [command.id]: "" }));
        }
        await api.restartInteractiveCommand(command.id, size.cols, size.rows);
        setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
        return;
      }

      if (autoClearLogs) {
        setLogs((current) => current.filter((line) => line.commandId !== command.id));
        setTerminalContentByCommandId((current) => ({
          ...current,
          [command.id]: "",
        }));
      }
      await api.restartCommand(command.id);
      setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
    } catch (error) {
      setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
      onErrorRef.current(error);
    }
  }

  async function handleKillPortsClick(command: ProjectCommand) {
    const ports = commandPorts(command);
    if (ports.length === 0) return;

    setScanningCommandId(command.id);
    try {
      const processes = await api.getPortsProcesses(ports);
      setPortProcesses(processes);
      setKillPortsCommand(command);
      setKillPortsDialogOpen(true);
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setScanningCommandId(null);
    }
  }

  async function handleKillProcesses(pids: number[]) {
    setKillingPorts(true);
    try {
      await api.killProcesses(pids);
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (killPortsCommand) {
        const ports = commandPorts(killPortsCommand);
        const processes = await api.getPortsProcesses(ports);
        setPortProcesses(processes);
      }
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setKillingPorts(false);
    }
  }

  async function handleRefreshProcesses() {
    if (!killPortsCommand) return;
    const ports = commandPorts(killPortsCommand);
    try {
      const processes = await api.getPortsProcesses(ports);
      setPortProcesses(processes);
    } catch (error) {
      onErrorRef.current(error);
    }
  }

  const stopCommandByCommandId = useCallback((commandId: number) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (interactiveSession) {
      void api.stopInteractiveCommand(interactiveSession.session_id).catch(onErrorRef.current);
      return;
    }

    const run = runs[commandId];
    if (run && !stoppingRunIds.has(run.runId)) {
      stopMutation.mutate(run.runId);
    }
  }, [interactiveSessionsByCommandId, runs, stopMutation, stoppingRunIds]);

  const forceStopCommandByCommandId = useCallback((commandId: number) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (interactiveSession) {
      void api.stopInteractiveCommand(interactiveSession.session_id).catch(onErrorRef.current);
      return;
    }

    const run = runs[commandId];
    if (!run) {
      return;
    }
    if (stoppingRunIds.has(run.runId)) {
      return;
    }
    stopMutation.mutate(run.runId);
  }, [interactiveSessionsByCommandId, runs, stopMutation, stoppingRunIds]);

  function clearCommandLogs(commandId: number) {
    setLogs((current) => current.filter((line) => line.commandId !== commandId));
    setTerminalContentByCommandId((current) => ({
      ...current,
      [commandId]: "",
    }));
  }

  const closeLogTabNow = useCallback((commandId: number) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (interactiveSession) {
      void api.stopInteractiveCommand(interactiveSession.session_id).catch(onErrorRef.current);
    } else {
      const run = runs[commandId];
      if (run && run.status === "running" && !stoppingRunIds.has(run.runId)) {
        stopMutation.mutate(run.runId);
      }
    }

    let nextActiveLogCommandId: number | null = null;
    setOpenLogCommandIds((current) => {
      const remaining = current.filter((id) => id !== commandId);
      nextActiveLogCommandId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      return remaining;
    });
    clearCommandLogs(commandId);
    setRuns((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
    setInteractiveSessionsByCommandId((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
    setActiveLogCommandId((current) => (current === commandId ? nextActiveLogCommandId : current));
  }, [interactiveSessionsByCommandId, runs, stopMutation, stoppingRunIds]);

  const handleTerminalInput = useCallback((commandId: number, data: string) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (!interactiveSession) {
      return;
    }
    void api.writeInteractiveTerminal(interactiveSession.session_id, data).catch(onErrorRef.current);
  }, [interactiveSessionsByCommandId]);

  const handleTerminalResize = useCallback((commandId: number, cols: number, rows: number) => {
    let sizeChanged = false;
    setInteractiveSizesByCommandId((current) => {
      const previousSize = current[commandId];
      if (previousSize?.cols === cols && previousSize?.rows === rows) {
        return current;
      }

      sizeChanged = true;
      return {
        ...current,
        [commandId]: { cols, rows },
      };
    });

    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (!interactiveSession || !sizeChanged) {
      return;
    }
    void api.resizeInteractiveTerminal(interactiveSession.session_id, cols, rows).catch(onErrorRef.current);
  }, [interactiveSessionsByCommandId]);

  return {
    runs,
    logs,
    terminalContentByCommandId,
    interactiveSessionsByCommandId,
    openLogCommandIds,
    activeLogCommandId,
    setActiveLogCommandId,
    stoppingRunIds,
    restartPendingCommandIds,
    scanningCommandId,
    killPortsCommand,
    portProcesses,
    killPortsDialogOpen,
    setKillPortsDialogOpen,
    killingPorts,
    startCommandRun,
    handleRestartCommand,
    handleKillPortsClick,
    handleKillProcesses,
    handleRefreshProcesses,
    openLogCommandTab,
    stopCommandByCommandId,
    forceStopCommandByCommandId,
    clearCommandLogs,
    closeLogTabNow,
    handleTerminalInput,
    handleTerminalResize,
  };
}
