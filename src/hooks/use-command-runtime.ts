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
  type Project,
  type ProjectCommand,
  type RunFinishedPayload,
  type RunOutputPayload,
  type RunStartedPayload,
} from "../lib/api";
import { commandPorts } from "../lib/command-utils";
import { formatTime } from "../lib/date-time";
import type { InteractiveTerminalKind } from "../lib/interactive-terminal";
import type { LogLine, RunState } from "../components/project-runtime";

const ANSI_ESCAPE_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cleanTerminalLine(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}

const DEFAULT_INTERACTIVE_COLS = 120;
const DEFAULT_INTERACTIVE_ROWS = 32;
const FLOW_TERMINAL_ID_OFFSET = 1_000_000_000;
let nextAdHocTerminalId = -1;

function terminalIdForEvent(commandId: number, runId: number, flowNodeId: string | null) {
  return flowNodeId ? -(FLOW_TERMINAL_ID_OFFSET + runId) : commandId;
}

export type FlowNodeExecution = {
  flowNodeId: string;
  runId: number;
  terminalId: number;
};

function buildAdHocInteractiveCommand(project: Project, terminalKind: InteractiveTerminalKind): ProjectCommand {
  const timestamp = new Date().toISOString();
  const label =
    terminalKind === "powershell" ? "pw" :
    terminalKind === "powershellcore" ? "pwsh" :
    terminalKind;

  return {
    id: nextAdHocTerminalId--,
    project_id: project.id,
    name: label,
    script: "",
    avatar_path: "lucide:terminal",
    ports: "[]",
    section: "Terminal",
    order_index: 0,
    created_at: timestamp,
    updated_at: timestamp,
    runtime_mode: "internal_interactive",
    run_in_external_terminal: false,
    external_terminal_kind: "default",
    interactive_terminal_kind: terminalKind,
    run_count: 0,
  };
}

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
  const interactiveSessionsByCommandIdRef = useRef<Record<number, InteractiveSession>>({});
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [terminalContentByCommandId, setTerminalContentByCommandId] = useState<Record<number, string>>({});
  const [interactiveSessionsByCommandId, setInteractiveSessionsByCommandId] = useState<Record<number, InteractiveSession>>({});
  const [interactiveSizesByCommandId, setInteractiveSizesByCommandId] = useState<Record<number, { cols: number; rows: number }>>({});
  const [adHocInteractiveCommands, setAdHocInteractiveCommands] = useState<ProjectCommand[]>([]);
  const [flowExecutionCommands, setFlowExecutionCommands] = useState<ProjectCommand[]>([]);
  const [openLogCommandIds, setOpenLogCommandIds] = useState<number[]>([]);
  const [activeLogCommandId, setActiveLogCommandId] = useState<number | null>(null);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<number>>(new Set());
  const [restartPendingCommandIds, setRestartPendingCommandIds] = useState<number[]>([]);
  const [scanningCommandId, setScanningCommandId] = useState<number | null>(null);
  const [killPortsCommand, setKillPortsCommand] = useState<ProjectCommand | null>(null);
  const [portProcesses, setPortProcesses] = useState<PortProcess[]>([]);
  const [killPortsDialogOpen, setKillPortsDialogOpen] = useState(false);
  const [killingPorts, setKillingPorts] = useState(false);

  useEffect(() => {
    interactiveSessionsByCommandIdRef.current = interactiveSessionsByCommandId;
  }, [interactiveSessionsByCommandId]);

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
        const entry = Object.entries(current).find(([, run]) => run.runId === runId);
        if (!entry) {
          return current;
        }
        const [terminalId, run] = entry;
        return {
          ...current,
          [terminalId]: {
            ...run,
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
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        setRuns((current) => ({
          ...current,
          [terminalId]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status: "running",
            startedAt: event.payload.started_at,
          },
        }));
        setOpenLogCommandIds((current) =>
          current.includes(terminalId) ? current : [...current, terminalId],
        );
        setActiveLogCommandId(terminalId);
      }),
      listen<RunOutputPayload>("command://stdout", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const cleanedLine = cleanTerminalLine(event.payload.line);
        const timestamp = formatTime(new Date());
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-out-${current.length}`,
            runId: event.payload.run_id,
            commandId: terminalId,
            stream: "stdout",
            line: cleanedLine,
            timestamp,
          },
        ]);
        setTerminalContentByCommandId((current) => ({
          ...current,
          [terminalId]: `${current[terminalId] ?? ""}${formatHeadlessTerminalLine("stdout", cleanedLine, timestamp)}\r\n`,
        }));
      }),
      listen<RunOutputPayload>("command://stderr", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const cleanedLine = cleanTerminalLine(event.payload.line);
        const timestamp = formatTime(new Date());
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-err-${current.length}`,
            runId: event.payload.run_id,
            commandId: terminalId,
            stream: "stderr",
            line: cleanedLine,
            timestamp,
          },
        ]);
        setTerminalContentByCommandId((current) => ({
          ...current,
          [terminalId]: `${current[terminalId] ?? ""}${formatHeadlessTerminalLine("stderr", cleanedLine, timestamp)}\r\n`,
        }));
      }),
      listen<RunFinishedPayload>("command://finished", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        setRuns((current) => ({
          ...current,
          [terminalId]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status:
              event.payload.status === "exited"
                ? "exited"
                : event.payload.status === "stopped"
                  ? "stopped"
                  : "failed",
            startedAt: current[terminalId]?.startedAt ?? event.payload.ended_at,
            endedAt: event.payload.ended_at,
            exitCode: event.payload.exit_code,
          },
        }));

        setRestartPendingCommandIds((current) => {
          if (event.payload.flow_node_id || !current.includes(event.payload.command_id)) {
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
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        setInteractiveSessionsByCommandId((current) => ({
          ...current,
          [terminalId]: event.payload,
        }));
        setInteractiveSizesByCommandId((current) => ({
          ...current,
          [terminalId]: {
            cols: event.payload.cols,
            rows: event.payload.rows,
          },
        }));
        setOpenLogCommandIds((current) =>
          current.includes(terminalId) ? current : [...current, terminalId],
        );
        setActiveLogCommandId(terminalId);
      }),
      listen<InteractiveSessionDataPayload>("pty://data", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        setTerminalContentByCommandId((current) => ({
          ...current,
          [terminalId]: `${current[terminalId] ?? ""}${event.payload.data}`,
        }));
      }),
      listen<InteractiveSessionExitedPayload>("pty://exit", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        setInteractiveSessionsByCommandId((current) => {
          const next = { ...current };
          delete next[terminalId];
          return next;
        });
      }),
      listen<InteractiveSessionErrorPayload>("pty://error", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        if (!interactiveSessionsByCommandIdRef.current[terminalId]) {
          return;
        }
        onErrorRef.current(new Error(event.payload.error));
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [autoClearLogs, showLogsTimestamp, showStreamName]);

  const openLogCommandTab = useCallback((commandId: number) => {
    setOpenLogCommandIds((current) => (current.includes(commandId) ? current : [...current, commandId]));
    setActiveLogCommandId(commandId);
  }, []);

  async function openAdHocInteractiveTerminal(project: Project, terminalKind: InteractiveTerminalKind, workingDirectory?: string) {
    const command = buildAdHocInteractiveCommand(project, terminalKind);
    setAdHocInteractiveCommands((current) => [...current, command]);
    openLogCommandTab(command.id);
    setTerminalContentByCommandId((current) => ({ ...current, [command.id]: "" }));

    try {
      await api.startProjectInteractiveTerminal(workingDirectory ?? project.path, command.id, terminalKind, DEFAULT_INTERACTIVE_COLS, DEFAULT_INTERACTIVE_ROWS);
    } catch (error) {
      setAdHocInteractiveCommands((current) => current.filter((item) => item.id !== command.id));
      setOpenLogCommandIds((current) => current.filter((id) => id !== command.id));
      setTerminalContentByCommandId((current) => {
        const next = { ...current };
        delete next[command.id];
        return next;
      });
      onErrorRef.current(error);
    }
  }

  async function startCommandRun(command: ProjectCommand): Promise<boolean> {
    const run = runs[command.id];
    if (run?.status === "running" || (run && stoppingRunIds.has(run.runId))) {
      return false;
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
        await runMutation.mutateAsync(command.id);
      }
      return true;
    } catch (error) {
      onErrorRef.current(error);
      return false;
    }
  }

  const startFlowNodeRun = useCallback(async (
    flowId: number,
    flowNodeId: string,
    command: ProjectCommand,
    label: string,
  ): Promise<FlowNodeExecution> => {
    const result = await api.startFlowNode(flowId, flowNodeId, DEFAULT_INTERACTIVE_COLS, DEFAULT_INTERACTIVE_ROWS);
    const terminalId = terminalIdForEvent(command.id, result.run.id, flowNodeId);
    const executionCommand = { ...command, id: terminalId, name: label };
    setFlowExecutionCommands((current) => current.some((item) => item.id === terminalId) ? current : [...current, executionCommand]);
    setRuns((current) => ({
      ...current,
      [terminalId]: current[terminalId] ?? {
        runId: result.run.id,
        commandId: command.id,
        status: "running",
        startedAt: result.run.started_at,
      },
    }));
    if (command.runtime_mode === "external_terminal") {
      setTerminalContentByCommandId((current) => ({
        ...current,
        [terminalId]: "This command is running in an external terminal window.\r\n",
      }));
    }
    openLogCommandTab(terminalId);
    return { flowNodeId, runId: result.run.id, terminalId };
  }, [openLogCommandTab]);

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
    setInteractiveSizesByCommandId((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
    setAdHocInteractiveCommands((current) => current.filter((command) => command.id !== commandId));
    setFlowExecutionCommands((current) => current.filter((command) => command.id !== commandId));
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
    adHocInteractiveCommands,
    flowExecutionCommands,
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
    startFlowNodeRun,
    handleRestartCommand,
    handleKillPortsClick,
    handleKillProcesses,
    handleRefreshProcesses,
    openLogCommandTab,
    openAdHocInteractiveTerminal,
    stopCommandByCommandId,
    forceStopCommandByCommandId,
    clearCommandLogs,
    closeLogTabNow,
    handleTerminalInput,
    handleTerminalResize,
  };
}
