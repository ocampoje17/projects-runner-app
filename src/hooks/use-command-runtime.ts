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
import {
  clearRegisteredTerminal,
  publishTerminalOutput,
  removeRegisteredTerminal,
} from "../lib/terminal-registry";
import type { LogLine, RunState } from "../components/project-runtime";

const ANSI_ESCAPE_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cleanTerminalLine(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}

const DEFAULT_INTERACTIVE_COLS = 120;
const DEFAULT_INTERACTIVE_ROWS = 32;
const FLOW_TERMINAL_ID_OFFSET = 1_000_000_000;
const MAX_HEADLESS_TERMINAL_CHARS = 1024 * 1024;
const MAX_LOG_LINES = 10_000;
let nextAdHocTerminalId = -1;

type InteractiveTerminalSize = {
  cols: number;
  rows: number;
};

function terminalIdForEvent(commandId: number, runId: number, flowNodeId: string | null) {
  return flowNodeId ? -(FLOW_TERMINAL_ID_OFFSET + runId) : commandId;
}

function appendBoundedTerminalContent(current: string, next: string) {
  const combined = `${current}${next}`;
  return combined.length <= MAX_HEADLESS_TERMINAL_CHARS
    ? combined
    : combined.slice(combined.length - MAX_HEADLESS_TERMINAL_CHARS);
}

async function waitForMeasuredTerminalSize(
  commandId: number,
  sizesRef: { current: Record<number, InteractiveTerminalSize> },
): Promise<InteractiveTerminalSize> {
  for (let frame = 0; frame < 4; frame += 1) {
    const measuredSize = sizesRef.current[commandId];
    if (measuredSize) {
      return measuredSize;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  return {
    cols: DEFAULT_INTERACTIVE_COLS,
    rows: DEFAULT_INTERACTIVE_ROWS,
  };
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
  const interactiveSizesByCommandIdRef = useRef<Record<number, InteractiveTerminalSize>>({});
  const stoppingInteractiveSessionIdsRef = useRef<Set<string>>(new Set());
  const inputQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingResizeBySessionRef = useRef<Map<string, { commandId: number; cols: number; rows: number }>>(new Map());
  const resizingSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [terminalContentByCommandId, setTerminalContentByCommandId] = useState<Record<number, string>>({});
  const [interactiveSessionsByCommandId, setInteractiveSessionsByCommandId] = useState<Record<number, InteractiveSession>>({});
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
          ...current.slice(-(MAX_LOG_LINES - 1)),
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
          [terminalId]: appendBoundedTerminalContent(
            current[terminalId] ?? "",
            `${formatHeadlessTerminalLine("stdout", cleanedLine, timestamp)}\r\n`,
          ),
        }));
      }),
      listen<RunOutputPayload>("command://stderr", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const cleanedLine = cleanTerminalLine(event.payload.line);
        const timestamp = formatTime(new Date());
        setLogs((current) => [
          ...current.slice(-(MAX_LOG_LINES - 1)),
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
          [terminalId]: appendBoundedTerminalContent(
            current[terminalId] ?? "",
            `${formatHeadlessTerminalLine("stderr", cleanedLine, timestamp)}\r\n`,
          ),
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
            clearRegisteredTerminal(event.payload.command_id);
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
        stoppingInteractiveSessionIdsRef.current.delete(event.payload.session_id);
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const measuredSize = interactiveSizesByCommandIdRef.current[terminalId];
        const sessionSize = {
          cols: event.payload.cols,
          rows: event.payload.rows,
        };
        const effectiveSize = measuredSize ?? sessionSize;

        interactiveSessionsByCommandIdRef.current = {
          ...interactiveSessionsByCommandIdRef.current,
          [terminalId]: event.payload,
        };
        setInteractiveSessionsByCommandId((current) => ({
          ...current,
          [terminalId]: event.payload,
        }));
        interactiveSizesByCommandIdRef.current = {
          ...interactiveSizesByCommandIdRef.current,
          [terminalId]: effectiveSize,
        };
        if (
          measuredSize &&
          (measuredSize.cols !== sessionSize.cols || measuredSize.rows !== sessionSize.rows)
        ) {
          void api
            .resizeInteractiveTerminal(
              event.payload.session_id,
              measuredSize.cols,
              measuredSize.rows,
            )
            .catch(onErrorRef.current);
        }
        setOpenLogCommandIds((current) =>
          current.includes(terminalId) ? current : [...current, terminalId],
        );
        setActiveLogCommandId(terminalId);
      }),
      listen<InteractiveSessionDataPayload>("pty://data", (event) => {
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const activeSession = interactiveSessionsByCommandIdRef.current[terminalId];
        if (activeSession?.session_id !== event.payload.session_id) {
          return;
        }
        publishTerminalOutput(terminalId, event.payload.data);
      }),
      listen<InteractiveSessionExitedPayload>("pty://exit", (event) => {
        stoppingInteractiveSessionIdsRef.current.delete(event.payload.session_id);
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        const activeSession = interactiveSessionsByCommandIdRef.current[terminalId];
        if (activeSession?.session_id !== event.payload.session_id) {
          return;
        }
        const nextSessions = { ...interactiveSessionsByCommandIdRef.current };
        delete nextSessions[terminalId];
        interactiveSessionsByCommandIdRef.current = nextSessions;
        pendingResizeBySessionRef.current.delete(event.payload.session_id);
        inputQueuesRef.current.delete(event.payload.session_id);
        setInteractiveSessionsByCommandId((current) => {
          const next = { ...current };
          delete next[terminalId];
          return next;
        });
      }),
      listen<InteractiveSessionErrorPayload>("pty://error", (event) => {
        if (stoppingInteractiveSessionIdsRef.current.has(event.payload.session_id)) {
          return;
        }
        const terminalId = terminalIdForEvent(event.payload.command_id, event.payload.run_id, event.payload.flow_node_id);
        if (interactiveSessionsByCommandIdRef.current[terminalId]?.session_id !== event.payload.session_id) {
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
      const size = await waitForMeasuredTerminalSize(
        command.id,
        interactiveSizesByCommandIdRef,
      );
      await api.startProjectInteractiveTerminal(
        workingDirectory ?? project.path,
        command.id,
        terminalKind,
        size.cols,
        size.rows,
      );
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
      clearRegisteredTerminal(command.id);
      setTerminalContentByCommandId((current) => ({
        ...current,
        [command.id]: "",
      }));
    }

    openLogCommandTab(command.id);

    try {
      if (command.runtime_mode === "internal_interactive") {
        const size = await waitForMeasuredTerminalSize(
          command.id,
          interactiveSizesByCommandIdRef,
        );
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
        const size = interactiveSizesByCommandIdRef.current[command.id] ?? {
          cols: DEFAULT_INTERACTIVE_COLS,
          rows: DEFAULT_INTERACTIVE_ROWS,
        };
        if (autoClearLogs) {
          clearRegisteredTerminal(command.id);
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

  const stopInteractiveSession = useCallback(async (session: InteractiveSession) => {
    const stoppingSessionIds = stoppingInteractiveSessionIdsRef.current;
    if (stoppingSessionIds.has(session.session_id)) {
      return;
    }

    stoppingSessionIds.add(session.session_id);
    try {
      const result = await api.stopInteractiveCommand(session.session_id);
      if (!result.was_active) {
        stoppingSessionIds.delete(session.session_id);
      }
    } catch (error) {
      stoppingSessionIds.delete(session.session_id);
      throw error;
    }
  }, []);

  const stopCommandByCommandId = useCallback((commandId: number) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (interactiveSession) {
      void stopInteractiveSession(interactiveSession).catch(onErrorRef.current);
      return;
    }

    const run = runs[commandId];
    if (run && !stoppingRunIds.has(run.runId)) {
      stopMutation.mutate(run.runId);
    }
  }, [interactiveSessionsByCommandId, runs, stopInteractiveSession, stopMutation, stoppingRunIds]);

  const forceStopCommandByCommandId = useCallback((commandId: number) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    if (interactiveSession) {
      void stopInteractiveSession(interactiveSession).catch(onErrorRef.current);
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
  }, [interactiveSessionsByCommandId, runs, stopInteractiveSession, stopMutation, stoppingRunIds]);

  function clearCommandLogs(commandId: number) {
    clearRegisteredTerminal(commandId);
    setLogs((current) => current.filter((line) => line.commandId !== commandId));
    setTerminalContentByCommandId((current) => ({
      ...current,
      [commandId]: "",
    }));
  }

  const closeLogTabNow = useCallback((commandId: number, reportStopError = true) => {
    const interactiveSession = interactiveSessionsByCommandId[commandId];
    let interactiveStop: Promise<void> | null = null;
    if (interactiveSession) {
      interactiveStop = stopInteractiveSession(interactiveSession);
      if (reportStopError) {
        void interactiveStop.catch(onErrorRef.current);
      }
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
    const nextSizes = { ...interactiveSizesByCommandIdRef.current };
    delete nextSizes[commandId];
    interactiveSizesByCommandIdRef.current = nextSizes;
    setAdHocInteractiveCommands((current) => current.filter((command) => command.id !== commandId));
    setFlowExecutionCommands((current) => current.filter((command) => command.id !== commandId));
    setActiveLogCommandId((current) => (current === commandId ? nextActiveLogCommandId : current));
    removeRegisteredTerminal(commandId);
    return interactiveStop ?? Promise.resolve();
  }, [interactiveSessionsByCommandId, runs, stopInteractiveSession, stopMutation, stoppingRunIds]);

  const closeLogTabsNow = useCallback(async (commandIds: number[]) => {
    const uniqueCommandIds = [...new Set(commandIds)];
    const results = await Promise.allSettled(
      uniqueCommandIds.map((commandId) => closeLogTabNow(commandId, false)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      onErrorRef.current(
        new Error(
          failures.length === 1
            ? "Unable to stop one interactive terminal."
            : `Unable to stop ${failures.length} interactive terminals.`,
        ),
      );
    }
  }, [closeLogTabNow]);

  const handleTerminalInput = useCallback((commandId: number, data: string) => {
    const interactiveSession = interactiveSessionsByCommandIdRef.current[commandId];
    if (
      !interactiveSession ||
      stoppingInteractiveSessionIdsRef.current.has(interactiveSession.session_id)
    ) {
      return;
    }

    const sessionId = interactiveSession.session_id;
    const previous = inputQueuesRef.current.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const activeSession = interactiveSessionsByCommandIdRef.current[commandId];
        if (
          activeSession?.session_id !== sessionId ||
          stoppingInteractiveSessionIdsRef.current.has(sessionId)
        ) {
          return;
        }
        await api.writeInteractiveTerminal(sessionId, data);
      })
      .catch(onErrorRef.current)
      .then(() => undefined);
    inputQueuesRef.current.set(sessionId, next);
    void next.finally(() => {
      if (inputQueuesRef.current.get(sessionId) === next) {
        inputQueuesRef.current.delete(sessionId);
      }
    });
  }, []);

  const handleTerminalResize = useCallback((commandId: number, cols: number, rows: number) => {
    const previousSize = interactiveSizesByCommandIdRef.current[commandId];
    if (previousSize?.cols === cols && previousSize?.rows === rows) {
      return;
    }

    interactiveSizesByCommandIdRef.current = {
      ...interactiveSizesByCommandIdRef.current,
      [commandId]: { cols, rows },
    };

    const interactiveSession = interactiveSessionsByCommandIdRef.current[commandId];
    if (
      !interactiveSession ||
      stoppingInteractiveSessionIdsRef.current.has(interactiveSession.session_id)
    ) {
      return;
    }
    const sessionId = interactiveSession.session_id;
    pendingResizeBySessionRef.current.set(sessionId, { commandId, cols, rows });
    if (resizingSessionIdsRef.current.has(sessionId)) {
      return;
    }

    resizingSessionIdsRef.current.add(sessionId);
    void (async () => {
      try {
        while (true) {
          const pending = pendingResizeBySessionRef.current.get(sessionId);
          if (!pending) break;
          pendingResizeBySessionRef.current.delete(sessionId);
          const activeSession = interactiveSessionsByCommandIdRef.current[pending.commandId];
          if (
            activeSession?.session_id !== sessionId ||
            stoppingInteractiveSessionIdsRef.current.has(sessionId)
          ) {
            break;
          }
          await api.resizeInteractiveTerminal(sessionId, pending.cols, pending.rows);
        }
      } catch (error) {
        onErrorRef.current(error);
      } finally {
        resizingSessionIdsRef.current.delete(sessionId);
      }
    })();
  }, []);

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
    closeLogTabsNow,
    handleTerminalInput,
    handleTerminalResize,
  };
}
