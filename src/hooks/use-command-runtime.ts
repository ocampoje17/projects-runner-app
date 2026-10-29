import { invoke } from "@tauri-apps/api/core";
import type { TerminalChannelEvent } from "../lib/api";
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
import { TerminalSessionManager } from "../lib/terminal-session-manager";
import type { LogLine, RunState } from "../components/project-runtime";

const ANSI_ESCAPE_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cleanTerminalLine(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}

const DEFAULT_INTERACTIVE_COLS = 120;
const DEFAULT_INTERACTIVE_ROWS = 32;
const MAX_HEADLESS_TERMINAL_CHARS = 1024 * 1024;
const MAX_LOG_LINES = 10_000;
const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_INPUT_CHUNK_SIZE = 16 * 1024;
const BATCH_WINDOW_MS = 4;
let nextAdHocTerminalId = -1;

type InteractiveTerminalSize = {
  cols: number;
  rows: number;
};

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
  const detachedIdsRef=useRef(new Map<string,number>());
  const pendingDetachedRef=useRef(new Map<string,TerminalChannelEvent[]>());
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
  const [openLogCommandIds, setOpenLogCommandIds] = useState<number[]>([]);
  const [activeLogCommandId, setActiveLogCommandId] = useState<number | null>(null);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<number>>(new Set());
  const [stoppingCommandIds, setStoppingCommandIds] = useState<Set<number>>(new Set());
  const [restartPendingCommandIds, setRestartPendingCommandIds] = useState<number[]>([]);
  const restartPendingCommandIdsRef = useRef<Set<number>>(new Set());
  const inputBatchesRef = useRef<Map<string, { buffer: string; timer: ReturnType<typeof setTimeout> | null; bytes: number }>>(new Map());
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
        const terminalId = event.payload.command_id;
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
        const terminalId = event.payload.command_id;
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
        const terminalId = event.payload.command_id;
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
        const terminalId = event.payload.command_id;
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

        const cmdId = event.payload.command_id;
        if (restartPendingCommandIdsRef.current.has(cmdId)) {
          restartPendingCommandIdsRef.current.delete(cmdId);
          setRestartPendingCommandIds((current) => current.filter((id) => id !== cmdId));

          if (autoClearLogs) {
            setLogs((lines) => lines.filter((line) => line.commandId !== cmdId));
            clearRegisteredTerminal(cmdId);
            setTerminalContentByCommandId((terminalContent) => ({
              ...terminalContent,
              [cmdId]: "",
            }));
          }
          void api.runCommand(cmdId).catch(onErrorRef.current);
        }
      }),
      listen<TerminalChannelEvent>("mcp://terminal-event", ({payload}) => {
        if(payload.type==="started"){
          detachedIdsRef.current.set(payload.session_id,payload.command_id);
          prepareInteractiveSession(payload.command_id);
          TerminalSessionManager.getOrCreate(payload.command_id,{fontSize:15}).handleChannelEvent(payload);
          setOpenLogCommandIds(current=>current.includes(payload.command_id)?current:[...current,payload.command_id]);setActiveLogCommandId(payload.command_id);
        }else{
          const cid=detachedIdsRef.current.get(payload.session_id);
          if(cid!==undefined) TerminalSessionManager.getOrCreate(cid,{fontSize:15}).handleChannelEvent(payload);
          else {
            const pending=pendingDetachedRef.current.get(payload.session_id)??[];pending.push(payload);
            if(pending.length>256)pending.shift();
            pendingDetachedRef.current.set(payload.session_id,pending);
            if(pendingDetachedRef.current.size>16)pendingDetachedRef.current.delete(pendingDetachedRef.current.keys().next().value!);
          }
          if(payload.type==="exited")detachedIdsRef.current.delete(payload.session_id);
        }
      }),
      listen<InteractiveSession>("pty://started", (event) => {
        stoppingInteractiveSessionIdsRef.current.delete(event.payload.session_id);
        const terminalId = event.payload.command_id;
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
        setRuns((current) => ({ ...current, [terminalId]: { runId: event.payload.run_id, commandId: event.payload.command_id, status: "running", startedAt: event.payload.started_at } }));
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
        const terminalId = event.payload.command_id;
        const activeSession = interactiveSessionsByCommandIdRef.current[terminalId];
        if (activeSession?.session_id !== event.payload.session_id) {
          return;
        }
        publishTerminalOutput(terminalId, event.payload.data);
      }),
      listen<InteractiveSessionExitedPayload>("pty://exit", (event) => {
        stoppingInteractiveSessionIdsRef.current.delete(event.payload.session_id);
        const terminalId = event.payload.command_id;
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
        setStoppingCommandIds((current) => { const next = new Set(current); next.delete(terminalId); return next; });
        setRuns((current) => ({ ...current, [terminalId]: { runId: event.payload.run_id, commandId: event.payload.command_id, status: event.payload.status === "failed" ? "failed" : event.payload.status === "exited" ? "exited" : "stopped", startedAt: current[terminalId]?.startedAt ?? event.payload.ended_at, endedAt: event.payload.ended_at, exitCode: event.payload.exit_code } }));
      }),
      listen<InteractiveSessionErrorPayload>("pty://error", (event) => {
        if (stoppingInteractiveSessionIdsRef.current.has(event.payload.session_id)) {
          return;
        }
        const terminalId = event.payload.command_id;
        if (interactiveSessionsByCommandIdRef.current[terminalId]?.session_id !== event.payload.session_id) {
          return;
        }
        onErrorRef.current(new Error(event.payload.error));
      }),
    ];

    void Promise.all(unlisteners).then(async () => {
      const active = await invoke<Array<{id:number;command_id:number;started_at:string}>>("active_command_runs");
      setRuns(current => {
        const next={...current};
        for(const run of active) if(!next[run.command_id]) next[run.command_id]={runId:run.id,commandId:run.command_id,status:"running",startedAt:run.started_at};
        return next;
      });
      setOpenLogCommandIds(current => [...new Set([...current,...active.map(r=>r.command_id)])]);
      const snapshots=await invoke<Array<{info:InteractiveSession;generation:number;sequence:number;data:string}>>("detached_terminal_snapshots");
      for(const snapshot of snapshots){const info=snapshot.info;
        if (interactiveSessionsByCommandIdRef.current[info.command_id]) continue;
        interactiveSessionsByCommandIdRef.current={...interactiveSessionsByCommandIdRef.current,[info.command_id]:info};
        setInteractiveSessionsByCommandId(current=>({...current,[info.command_id]:info}));
        setRuns(current=>({...current,[info.command_id]:{runId:info.run_id,commandId:info.command_id,status:"running",startedAt:info.started_at}}));
        setOpenLogCommandIds(current=>current.includes(info.command_id)?current:[...current,info.command_id]);
        detachedIdsRef.current.set(info.session_id,info.command_id);
        prepareInteractiveSession(info.command_id);
        setActiveLogCommandId(current=>current??info.command_id);
        const terminal=TerminalSessionManager.getOrCreate(info.command_id,{fontSize:15});
        terminal.handleChannelEvent({type:"started",...info,generation:snapshot.generation,sequence:0});
        terminal.handleChannelEvent({type:"output",session_id:info.session_id,generation:snapshot.generation,sequence:snapshot.sequence,data:snapshot.data});
        for(const pending of pendingDetachedRef.current.get(info.session_id)??[]){if(pending.sequence>snapshot.sequence)terminal.handleChannelEvent(pending);}
        pendingDetachedRef.current.delete(info.session_id);
      }
    }).catch(onErrorRef.current);
    return () => {
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [autoClearLogs, showLogsTimestamp, showStreamName]);

  const prepareInteractiveSession = useCallback((terminalId: number) => {
    const session = TerminalSessionManager.getOrCreate(terminalId, {
      fontSize: 15,
    });
    session.onChannelEvent = (event) => {
      if (event.type === "started") {
        const tId = event.command_id;
        stoppingInteractiveSessionIdsRef.current.delete(event.session_id);
        const measuredSize = interactiveSizesByCommandIdRef.current[tId];
        const sessionSize = { cols: event.cols, rows: event.rows };
        const effectiveSize = measuredSize ?? sessionSize;
        if (measuredSize && (measuredSize.cols !== event.cols || measuredSize.rows !== event.rows)) {
          void api.resizeInteractiveTerminal(event.session_id, measuredSize.cols, measuredSize.rows).catch(() => {});
        }
        const info: InteractiveSession = {
          session_id: event.session_id,
          run_id: event.run_id,
          command_id: event.command_id,
          cols: effectiveSize.cols,
          rows: effectiveSize.rows,
          started_at: event.started_at,
        };
        interactiveSessionsByCommandIdRef.current = {
          ...interactiveSessionsByCommandIdRef.current,
          [tId]: info,
        };
        setInteractiveSessionsByCommandId((current) => ({
          ...current,
          [tId]: info,
        }));
        setRuns((current) => ({
          ...current,
          [tId]: {
            runId: event.run_id,
            commandId: event.command_id,
            status: "running",
            startedAt: event.started_at,
          },
        }));
      } else if (event.type === "exited") {
        stoppingInteractiveSessionIdsRef.current.delete(event.session_id);
        const tId = event.command_id;
        const nextSessions = { ...interactiveSessionsByCommandIdRef.current };
        delete nextSessions[tId];
        interactiveSessionsByCommandIdRef.current = nextSessions;
        pendingResizeBySessionRef.current.delete(event.session_id);
        inputQueuesRef.current.delete(event.session_id);
        setInteractiveSessionsByCommandId((current) => {
          const next = { ...current };
          delete next[tId];
          return next;
        });
        setStoppingCommandIds((current) => {
          const next = new Set(current);
          next.delete(tId);
          return next;
        });
        setRuns((current) => ({
          ...current,
          [tId]: {
            runId: event.run_id,
            commandId: event.command_id,
            status:
              event.status === "failed"
                ? "failed"
                : event.status === "exited"
                  ? "exited"
                  : "stopped",
            startedAt: current[tId]?.startedAt ?? event.ended_at,
            endedAt: event.ended_at,
            exitCode: event.exit_code,
          },
        }));
      } else if (event.type === "error") {
        if (!stoppingInteractiveSessionIdsRef.current.has(event.session_id)) {
          onErrorRef.current(new Error(event.error));
        }
      }
    };
    return session.createChannel();
  }, []);

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
      const onEvent = prepareInteractiveSession(command.id);
      await api.startProjectInteractiveTerminal(
        workingDirectory ?? project.path,
        command.id,
        terminalKind,
        size.cols,
        size.rows,
        onEvent,
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
        const onEvent = prepareInteractiveSession(command.id);
        await api.startInteractiveCommand(command.id, size.cols, size.rows, onEvent);
      } else {
        await runMutation.mutateAsync(command.id);
      }
      return true;
    } catch (error) {
      onErrorRef.current(error);
      return false;
    }
  }


  async function handleRestartCommand(command: ProjectCommand) {
    openLogCommandTab(command.id);
    restartPendingCommandIdsRef.current.add(command.id);
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
        const onEvent = prepareInteractiveSession(command.id);
        await api.restartInteractiveCommand(command.id, size.cols, size.rows, onEvent);
        restartPendingCommandIdsRef.current.delete(command.id);
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
      restartPendingCommandIdsRef.current.delete(command.id);
      setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
    } catch (error) {
      restartPendingCommandIdsRef.current.delete(command.id);
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
    const terminalId = session.command_id;
    const stoppingSessionIds = stoppingInteractiveSessionIdsRef.current;
    if (stoppingSessionIds.has(session.session_id)) {
      return;
    }

    stoppingSessionIds.add(session.session_id);
    setStoppingCommandIds((current) => new Set(current).add(terminalId));
    try {
      const result = await api.stopInteractiveCommand(session.session_id);
      if (!result.was_active) {
        stoppingSessionIds.delete(session.session_id);
        setStoppingCommandIds((current) => { const next = new Set(current); next.delete(terminalId); return next; });
      }
    } catch (error) {
      stoppingSessionIds.delete(session.session_id);
      setStoppingCommandIds((current) => { const next = new Set(current); next.delete(terminalId); return next; });
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

  const closeLogTabNow = useCallback((commandId: number) => {
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
    setActiveLogCommandId((current) => (current === commandId ? nextActiveLogCommandId : current));
    removeRegisteredTerminal(commandId);
    TerminalSessionManager.destroy(commandId);
  }, []);

  const closeLogTabsNow = useCallback(async (commandIds: number[]) => {
    const uniqueCommandIds = [...new Set(commandIds)];
    const results = await Promise.allSettled(
      uniqueCommandIds.map(async (commandId) => closeLogTabNow(commandId)),
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
    let entry = inputBatchesRef.current.get(sessionId);
    if (!entry) {
      entry = { buffer: "", timer: null, bytes: 0 };
      inputBatchesRef.current.set(sessionId, entry);
    }

    // Limit pending input to 256 KiB
    const newBytes = data.length;
    if (entry.bytes + newBytes > MAX_PENDING_INPUT_BYTES) {
      const allowed = Math.max(0, MAX_PENDING_INPUT_BYTES - entry.bytes);
      if (allowed > 0) {
        entry.buffer += data.slice(0, allowed);
        entry.bytes += allowed;
      }
      return;
    }

    entry.buffer += data;
    entry.bytes += newBytes;

    if (entry.timer === null) {
      entry.timer = setTimeout(() => {
        const currentEntry = inputBatchesRef.current.get(sessionId);
        if (!currentEntry) return;
        currentEntry.timer = null;
        const textToSend = currentEntry.buffer;
        currentEntry.buffer = "";
        currentEntry.bytes = 0;

        if (!textToSend) return;

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
            for (let i = 0; i < textToSend.length; i += MAX_INPUT_CHUNK_SIZE) {
              const chunk = textToSend.slice(i, i + MAX_INPUT_CHUNK_SIZE);
              await api.writeInteractiveTerminal(sessionId, chunk);
            }
          })
          .catch(onErrorRef.current)
          .then(() => undefined);

        inputQueuesRef.current.set(sessionId, next);
        void next.finally(() => {
          if (inputQueuesRef.current.get(sessionId) === next) {
            inputQueuesRef.current.delete(sessionId);
          }
        });
      }, BATCH_WINDOW_MS);
    }
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
    interactiveSessionsByCommandId,
    openLogCommandIds,
    activeLogCommandId,
    setActiveLogCommandId,
    stoppingRunIds,
    stoppingCommandIds,
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
