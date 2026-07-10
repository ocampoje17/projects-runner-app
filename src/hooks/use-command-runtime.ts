import { listen } from "@tauri-apps/api/event";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  isDesktopRuntime,
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

export function useCommandRuntime({
  autoClearLogs,
  onError,
}: {
  autoClearLogs: boolean;
  onError: (error: unknown) => void;
}) {
  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [openLogCommandIds, setOpenLogCommandIds] = useState<number[]>([]);
  const [activeLogCommandId, setActiveLogCommandId] = useState<number | null>(null);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<number>>(new Set());
  const [restartPendingCommandIds, setRestartPendingCommandIds] = useState<number[]>([]);
  const [scanningCommandId, setScanningCommandId] = useState<number | null>(null);
  const [killPortsCommand, setKillPortsCommand] = useState<ProjectCommand | null>(null);
  const [portProcesses, setPortProcesses] = useState<PortProcess[]>([]);
  const [killPortsDialogOpen, setKillPortsDialogOpen] = useState(false);
  const [killingPorts, setKillingPorts] = useState(false);

  const runMutation = useMutation({
    mutationFn: api.runCommand,
    onError,
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
    onError,
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
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-out-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stdout",
            line: cleanTerminalLine(event.payload.line),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }),
      listen<RunOutputPayload>("command://stderr", (event) => {
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-err-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stderr",
            line: cleanTerminalLine(event.payload.line),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
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
          }
          void api.runCommand(event.payload.command_id).catch(onError);
          return current.filter((id) => id !== event.payload.command_id);
        });
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [autoClearLogs, onError]);

  function openLogCommandTab(commandId: number) {
    setOpenLogCommandIds((current) => (current.includes(commandId) ? current : [...current, commandId]));
    setActiveLogCommandId(commandId);
  }

  function startCommandRun(commandId: number) {
    if (autoClearLogs) {
      setLogs((current) => current.filter((line) => line.commandId !== commandId));
    }
    openLogCommandTab(commandId);
    runMutation.mutate(commandId);
  }

  async function handleRestartCommand(command: ProjectCommand) {
    openLogCommandTab(command.id);

    const run = runs[command.id];
    if (run?.status === "running") {
      setRestartPendingCommandIds((current) => (current.includes(command.id) ? current : [...current, command.id]));
      try {
        const result = await stopMutation.mutateAsync(run.runId);
        if (!result.was_active) {
          setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
          startCommandRun(command.id);
        }
      } catch (error) {
        setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
        onError(error);
      }
      return;
    }

    startCommandRun(command.id);
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
      onError(error);
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
      onError(error);
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
      onError(error);
    }
  }

  function stopCommandByCommandId(commandId: number) {
    const run = runs[commandId];
    if (run) {
      stopMutation.mutate(run.runId);
    }
  }

  function forceResetCommand(commandId: number) {
    setStoppingRunIds((current) => {
      const next = new Set(current);
      const runId = runs[commandId]?.runId;
      if (runId !== undefined) next.delete(runId);
      return next;
    });
    setRestartPendingCommandIds((current) => current.filter((id) => id !== commandId));
    setOpenLogCommandIds((current) => current.filter((id) => id !== commandId));
    setLogs((current) => current.filter((line) => line.commandId !== commandId));
    setRuns((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
    setActiveLogCommandId((current) => (current === commandId ? null : current));
  }

  function clearCommandLogs(commandId: number) {
    setLogs((current) => current.filter((line) => line.commandId !== commandId));
  }

  function closeLogTabNow(commandId: number) {
    const run = runs[commandId];
    if (run && run.status === "running") {
      stopMutation.mutate(run.runId);
    }

    setOpenLogCommandIds((current) => current.filter((id) => id !== commandId));
    clearCommandLogs(commandId);
    setRuns((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
    setActiveLogCommandId((current) => {
      if (current !== commandId) {
        return current;
      }

      const remaining = openLogCommandIds.filter((id) => id !== commandId);
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }

  return {
    runs,
    logs,
    setLogs,
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
    forceResetCommand,
    clearCommandLogs,
    closeLogTabNow,
  };
}
