import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FlowDetail, type ProjectCommand, type ProjectFlow } from "../lib/api";
import type { RunState } from "../components/project-runtime";
import type { FlowNodeExecution } from "./use-command-runtime";

export type FlowRunStatus = "idle" | "starting" | "running" | "degraded" | "completed" | "stopped" | "failed";
export type FlowNodeRunStatus = "queued" | "starting" | "running" | "success" | "failed" | "stopped";
export type FlowNodeRun = FlowNodeExecution & { commandId: number };
export type FlowRunState = {
  status: FlowRunStatus;
  nodeRuns: Record<string, FlowNodeRun>;
  nodeStatuses: Record<string, FlowNodeRunStatus>;
  error?: string;
};

function orderedNodes(detail: FlowDetail) {
  const nodeById = new Map(detail.nodes.map((node) => [node.id, node]));
  const incomingCounts = new Map(detail.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of detail.edges) {
    if (!nodeById.has(edge.source_node_id) || !nodeById.has(edge.target_node_id)) return [];
    incomingCounts.set(edge.target_node_id, (incomingCounts.get(edge.target_node_id) ?? 0) + 1);
    outgoing.set(edge.source_node_id, [...(outgoing.get(edge.source_node_id) ?? []), edge.target_node_id]);
  }
  const sortNodes = (left: FlowDetail["nodes"][number], right: FlowDetail["nodes"][number]) =>
    left.position_y - right.position_y || left.position_x - right.position_x || left.id.localeCompare(right.id);
  const ready = detail.nodes.filter((node) => incomingCounts.get(node.id) === 0).sort(sortNodes);
  const result: FlowDetail["nodes"] = [];
  while (ready.length > 0) {
    const node = ready.shift();
    if (!node) break;
    result.push(node);
    for (const nextId of outgoing.get(node.id) ?? []) {
      const nextCount = (incomingCounts.get(nextId) ?? 0) - 1;
      incomingCounts.set(nextId, nextCount);
      if (nextCount === 0) {
        const next = nodeById.get(nextId);
        if (!next) return [];
        ready.push(next);
        ready.sort(sortNodes);
      }
    }
  }
  return result.length === detail.nodes.length ? result : [];
}

export function useFlowRuntime({
  commandsByProjectId,
  runs,
  startFlowNodeRun,
  stopCommandByCommandId,
  onError,
}: {
  commandsByProjectId: Record<number, ProjectCommand[]>;
  runs: Record<number, RunState>;
  startFlowNodeRun: (flowId: number, flowNodeId: string, command: ProjectCommand, label: string) => Promise<FlowNodeExecution>;
  stopCommandByCommandId: (commandId: number) => void;
  onError: (error: unknown) => void;
}) {
  const [flowRuns, setFlowRuns] = useState<Record<number, FlowRunState>>({});
  const startingFlowIdsRef = useRef(new Set<number>());
  const stopRequestedFlowIdsRef = useRef(new Set<number>());

  useEffect(() => {
    const terminalIdsToStop: number[] = [];
    let changed = false;
    const next = { ...flowRuns };
    Object.entries(flowRuns).forEach(([rawFlowId, state]) => {
      if (!["starting", "running", "degraded"].includes(state.status)) return;
      const nodeStatuses = { ...state.nodeStatuses };
      let nodeStatusesChanged = false;
      Object.entries(state.nodeRuns).forEach(([nodeId, nodeRun]) => {
        const runStatus = runs[nodeRun.terminalId]?.status;
        const nextNodeStatus: FlowNodeRunStatus | undefined =
          runStatus === "running"
            ? "running"
            : runStatus === "exited"
              ? "success"
              : runStatus === "failed"
                ? "failed"
                : runStatus === "stopped"
                  ? "stopped"
                  : undefined;
        if (nextNodeStatus && nodeStatuses[nodeId] !== nextNodeStatus) {
          nodeStatuses[nodeId] = nextNodeStatus;
          nodeStatusesChanged = true;
        }
      });
        const nodeRuns = Object.values(state.nodeRuns);
      if (nodeRuns.length === 0) {
        if (nodeStatusesChanged) {
          next[Number(rawFlowId)] = { ...state, nodeStatuses };
          changed = true;
        }
        return;
      }
      const statuses = nodeRuns.map((nodeRun) => runs[nodeRun.terminalId]?.status);
      const hasFailed = statuses.some((status) => status === "failed");
      const hasRunning = statuses.some((status) => status === "running");
      const allFinished = statuses.every((status) => status === "exited" || status === "stopped" || status === "failed");
      const status: FlowRunStatus = hasFailed
        ? "failed"
        : allFinished
          ? (statuses.some((value) => value === "stopped") ? "stopped" : "completed")
          : hasRunning
            ? "running"
            : state.status;
      if (status === "failed") {
        terminalIdsToStop.push(...nodeRuns.filter((nodeRun) => runs[nodeRun.terminalId]?.status === "running").map((nodeRun) => nodeRun.terminalId));
      }
      if (status !== state.status || nodeStatusesChanged) {
        next[Number(rawFlowId)] = { ...state, status, nodeStatuses };
        changed = true;
      }
    });
    if (changed) setFlowRuns(next);
    terminalIdsToStop.forEach(stopCommandByCommandId);
  }, [flowRuns, runs, stopCommandByCommandId]);

  const runFlow = useCallback(async (flow: ProjectFlow) => {
    if (startingFlowIdsRef.current.has(flow.id) || ["starting", "running", "degraded"].includes(flowRuns[flow.id]?.status ?? "idle")) return;
    startingFlowIdsRef.current.add(flow.id);
    stopRequestedFlowIdsRef.current.delete(flow.id);
    const nodeRuns: Record<string, FlowNodeRun> = {};
    let nodeStatuses: Record<string, FlowNodeRunStatus> = {};
    setFlowRuns((current) => ({
      ...current,
      [flow.id]: { status: "starting", nodeRuns, nodeStatuses },
    }));
    try {
      const detail = await api.getFlow(flow.id);
      const nodes = orderedNodes(detail);
      if (nodes.length === 0 || nodes.length !== detail.nodes.length) throw new Error("The flow graph must not contain a cycle before running it.");
      const commands = new Map((commandsByProjectId[flow.project_id] ?? []).map((command) => [command.id, command]));
      const commandCounts = new Map<number, number>();
      for (const node of nodes) commandCounts.set(node.command_id, (commandCounts.get(node.command_id) ?? 0) + 1);
      nodeStatuses = Object.fromEntries(nodes.map((node) => [node.id, "queued" as const]));
      setFlowRuns((current) => ({ ...current, [flow.id]: { status: "starting", nodeRuns, nodeStatuses } }));
      const occurrence = new Map<number, number>();
      for (const node of nodes) {
        if (stopRequestedFlowIdsRef.current.has(flow.id)) {
          setFlowRuns((current) => ({ ...current, [flow.id]: { status: "stopped", nodeRuns, nodeStatuses } }));
          return;
        }
        const command = commands.get(node.command_id);
        if (!command) throw new Error("This flow references a command that is no longer available.");
        const number = (occurrence.get(command.id) ?? 0) + 1;
        occurrence.set(command.id, number);
        const label = commandCounts.get(command.id)! > 1 ? `${command.name} · ${number}` : command.name;
        nodeStatuses = { ...nodeStatuses, [node.id]: "starting" };
        setFlowRuns((current) => ({ ...current, [flow.id]: { status: "starting", nodeRuns: { ...nodeRuns }, nodeStatuses } }));
        const execution = await startFlowNodeRun(flow.id, node.id, command, label);
        nodeRuns[node.id] = { ...execution, commandId: command.id };
        if (stopRequestedFlowIdsRef.current.has(flow.id)) {
          nodeStatuses = { ...nodeStatuses, [node.id]: "stopped" };
          stopCommandByCommandId(execution.terminalId);
          setFlowRuns((current) => ({ ...current, [flow.id]: { status: "stopped", nodeRuns, nodeStatuses } }));
          return;
        }
        nodeStatuses = { ...nodeStatuses, [node.id]: "running" };
        setFlowRuns((current) => ({ ...current, [flow.id]: { status: "starting", nodeRuns: { ...nodeRuns }, nodeStatuses } }));
      }
      setFlowRuns((current) => ({ ...current, [flow.id]: { status: "running", nodeRuns, nodeStatuses } }));
    } catch (error) {
      Object.values(nodeRuns).forEach((nodeRun) => stopCommandByCommandId(nodeRun.terminalId));
      const failedNodeId = Object.entries(nodeStatuses).find(([, status]) => status === "starting")?.[0];
      if (failedNodeId) nodeStatuses = { ...nodeStatuses, [failedNodeId]: "failed" };
      setFlowRuns((current) => ({ ...current, [flow.id]: { status: "failed", nodeRuns, nodeStatuses, error: error instanceof Error ? error.message : "Unable to start flow." } }));
      onError(error);
    } finally {
      startingFlowIdsRef.current.delete(flow.id);
    }
  }, [commandsByProjectId, flowRuns, onError, startFlowNodeRun, stopCommandByCommandId]);

  const stopFlow = useCallback((flowId: number) => {
    const state = flowRuns[flowId];
    if (!state) return;
    stopRequestedFlowIdsRef.current.add(flowId);
    setFlowRuns((current) => ({
      ...current,
      [flowId]: {
        ...state,
        status: "stopped",
        nodeStatuses: Object.fromEntries(
          Object.entries(state.nodeStatuses).map(([nodeId, status]) => [nodeId, status === "running" || status === "starting" ? "stopped" : status]),
        ),
      },
    }));
    Object.values(state.nodeRuns).forEach((nodeRun) => stopCommandByCommandId(nodeRun.terminalId));
  }, [flowRuns, stopCommandByCommandId]);

  const clearFlowRuntime = useCallback((flowId: number) => setFlowRuns((current) => {
    if (!current[flowId]) return current;
    const next = { ...current }; delete next[flowId]; return next;
  }), []);

  return { flowRuns, runFlow, stopFlow, clearFlowRuntime };
}
