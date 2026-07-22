import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type OnConnect, type OnEdgesChange, type OnNodesChange, addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, CircleStop, GitBranch, LoaderCircle, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type FlowDetail, type Project, type ProjectCommand, type ProjectFlow } from "../lib/api";
import type { RunState } from "./project-runtime";
import type { FlowNodeRunStatus, FlowRunState } from "../hooks/use-flow-runtime";
import { ConfirmDialog } from "./process-dialogs";
import { FlowFormDialog } from "./flow-form-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { formatDateTime } from "../lib/date-time";

type FlowCommandNodeData = { nodeId: string; command: ProjectCommand; displayName: string; status: "idle" | FlowNodeRunStatus; onOpenLog: (nodeId: string) => void };

function FlowCommandNode({ data, selected }: NodeProps<Node<FlowCommandNodeData>>) {
  const { command, status, onOpenLog } = data;
  const statusLabel = status === "failed" ? "Crashed" : status === "running" ? "Running" : status === "starting" ? "Starting" : status === "queued" ? "Queued" : status === "success" ? "Completed" : status === "stopped" ? "Stopped" : "Ready";
  return <div className={`flow-command-node flow-command-node-${status} ${selected ? "is-selected" : ""}`}>
    <Handle type="target" position={Position.Top} className="flow-handle" />
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><div className="truncate text-[12px] font-semibold">{data.displayName}</div><div className="mt-1 truncate font-mono text-[10px] opacity-65">{command.script || "Interactive terminal"}</div></div>
      <span className="flow-status-dot" aria-label={statusLabel} />
    </div>
    <div className="mt-2 flex items-center gap-2 text-[10px] opacity-75"><span>{statusLabel}</span><span className="min-w-0 flex-1 truncate">{command.runtime_mode.replace(/_/g, " ")}</span><button type="button" onClick={(event) => { event.stopPropagation(); onOpenLog(data.nodeId); }} className="shrink-0 underline underline-offset-2 hover:opacity-100">Log</button></div>
    {status === "failed" ? <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--vscode-danger)]"><AlertTriangle size={12} /> Process crashed</div> : null}
    <Handle type="source" position={Position.Bottom} className="flow-handle" />
  </div>;
}

const nodeTypes = { command: FlowCommandNode };

export function FlowLauncher({ project, flow, commands, runs: _runs, flowRun, onRunFlow, onStopFlow, onOpenLogs, onDeleted }: {
  project: Project;
  flow: ProjectFlow;
  commands: ProjectCommand[];
  runs: Record<number, RunState>;
  flowRun?: FlowRunState;
  onRunFlow: (flow: ProjectFlow) => void;
  onStopFlow: (flowId: number) => void;
  onOpenLogs: (commandId: number) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["flow", flow.id], queryFn: () => api.getFlow(flow.id) });
  const [nodes, setNodes] = useState<Node<FlowCommandNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadedFlowId, setLoadedFlowId] = useState<number | null>(null);
  const [flowName, setFlowName] = useState(flow.name);
  const [isDirty, setIsDirty] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const detail = detailQuery.data;

  const nodeStatus = useCallback((nodeId: string): FlowCommandNodeData["status"] => {
    return flowRun?.nodeStatuses[nodeId] ?? "idle";
  }, [flowRun]);

  const openNodeLog = useCallback((nodeId: string) => {
    const terminalId = flowRun?.nodeRuns[nodeId]?.terminalId;
    if (terminalId !== undefined) onOpenLogs(terminalId);
  }, [flowRun, onOpenLogs]);

  const hydrate = useCallback((value: FlowDetail) => {
    const commandById = new Map(commands.map((command) => [command.id, command]));
    const commandCounts = new Map<number, number>();
    value.nodes.forEach((node) => commandCounts.set(node.command_id, (commandCounts.get(node.command_id) ?? 0) + 1));
    const commandOccurrence = new Map<number, number>();
    setNodes(value.nodes.flatMap((node) => {
      const command = commandById.get(node.command_id);
      if (!command) return [];
      const occurrence = (commandOccurrence.get(command.id) ?? 0) + 1;
      commandOccurrence.set(command.id, occurrence);
      const displayName = commandCounts.get(command.id)! > 1 ? `${command.name} · ${occurrence}` : command.name;
      return [{ id: node.id, type: "command", position: { x: node.position_x, y: node.position_y }, data: { nodeId: node.id, command, displayName, status: nodeStatus(node.id), onOpenLog: openNodeLog } }];
    }));
    setEdges(value.edges.map((edge) => ({ id: edge.id, source: edge.source_node_id, target: edge.target_node_id, type: "smoothstep", animated: false })));
    setLoadedFlowId(value.flow.id);
    setIsDirty(false);
  }, [commands, nodeStatus, openNodeLog]);

  useEffect(() => {
    if (detail && loadedFlowId !== detail.flow.id) hydrate(detail);
  }, [detail, hydrate, loadedFlowId]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const status = nodeStatus(node.id);
      return node.data.status === status && node.data.onOpenLog === openNodeLog ? node : { ...node, data: { ...node.data, status, onOpenLog: openNodeLog } };
    }));
  }, [nodeStatus, openNodeLog]);

  useEffect(() => { setFlowName(flow.name); }, [flow.id, flow.name]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveFlowGraph(flow.id, { name: flowName.trim(), nodes: nodes.map((node) => ({ id: node.id, command_id: node.data.command.id, position_x: Math.round(node.position.x), position_y: Math.round(node.position.y) })), edges: edges.map((edge) => ({ id: edge.id, source_node_id: edge.source, target_node_id: edge.target })) }),
    onSuccess: (value) => { queryClient.setQueryData(["flow", flow.id], value); queryClient.invalidateQueries({ queryKey: ["flows", flow.project_id] }); hydrate(value); },
  });
  const editMutation = useMutation({
    mutationFn: (name: string) => api.updateFlow(flow.id, name),
    onSuccess: (value) => {
      setFlowName(value.name);
      setEditDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["flows", flow.project_id] });
      void queryClient.invalidateQueries({ queryKey: ["flow", flow.id] });
    },
  });

  const onNodesChange: OnNodesChange<Node<FlowCommandNodeData>> = useCallback((changes) => {
    // Selection and measured dimensions are UI-only React Flow changes. They must
    // not make the persisted graph dirty or prevent a flow from being run.
    if (changes.some((change) => ["add", "remove", "replace", "position"].includes(change.type))) setIsDirty(true);
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    if (changes.some((change) => ["add", "remove", "replace"].includes(change.type))) setIsDirty(true);
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onConnect: OnConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setEdges((current) => {
      const hasConnection = current.some((edge) =>
        (edge.source === connection.source && edge.target === connection.target)
        || (edge.source === connection.target && edge.target === connection.source),
      );
      if (hasConnection) return current;
      setIsDirty(true);
      return addEdge({ ...connection, id: crypto.randomUUID(), type: "smoothstep" }, current);
    });
  }, []);
  const selectedNodeIds = useMemo(() => new Set(nodes.filter((node) => node.selected).map((node) => node.id)), [nodes]);
  const isActive = ["starting", "running", "degraded"].includes(flowRun?.status ?? "idle");

  function addCommand(command: ProjectCommand) {
    setIsDirty(true);
    const nodeId = crypto.randomUUID();
    setNodes((current) => {
      const occurrence = current.filter((node) => node.data.command.id === command.id).length + 1;
      const relabeled = occurrence === 1 ? current : current.map((node) => node.data.command.id === command.id && node.data.displayName === command.name ? { ...node, data: { ...node.data, displayName: `${command.name} · 1` } } : node);
      return [...relabeled, { id: nodeId, type: "command", position: { x: 80, y: current.length * 155 + 40 }, data: { nodeId, command, displayName: occurrence === 1 ? command.name : `${command.name} · ${occurrence}`, status: "idle", onOpenLog: openNodeLog } }];
    });
  }
  function removeSelectedNodes() {
    if (selectedNodeIds.size === 0) return;
    setIsDirty(true);
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) => current.filter((edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)));
  }
  if (detailQuery.isLoading) return <div className="flex h-full items-center justify-center text-sm opacity-70"><LoaderCircle className="mr-2 animate-spin" size={16} /> Loading flow…</div>;
  if (detailQuery.isError || !detail) return <div className="p-5 text-sm text-[var(--vscode-danger)]">Could not load this flow.</div>;
  return <section className="flex h-full min-h-0 flex-col bg-[var(--vscode-editor)]">
    <header className="shrink-0 border-b border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-6 py-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start justify-between gap-4">
        <div className="py-1">
          <div className="flex flex-wrap items-center gap-2">
            <GitBranch size={19} className="opacity-70" />
            <h2 className="text-[22px] font-semibold text-foreground">{flowName}</h2>
            <Badge variant={isActive ? "success" : "muted"}>{isActive ? "Running" : "Ready"}</Badge>
            <Badge variant="muted">{project.name}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-[var(--vscode-foreground)]/68">Updated {formatDateTime(flow.updated_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2 py-1">
          <Button title={isDirty ? "Save flow changes before running." : undefined} disabled={isActive || nodes.length === 0 || isDirty} onClick={() => onRunFlow(flow)}><Play size={14} /> Run flow</Button>
          <Button variant="outline" disabled={!isActive} onClick={() => onStopFlow(flow.id)}><CircleStop size={14} /> Stop</Button>
          <Button variant="secondary" disabled={isActive} onClick={() => setEditDialogOpen(true)}><Pencil size={14} /> Edit</Button>
          <Button variant="secondary" disabled={isActive || selectedNodeIds.size === 0} onClick={removeSelectedNodes}><Trash2 size={14} /> Remove node</Button>
          <Button variant="secondary" disabled={isActive || saveMutation.isPending || !flowName.trim() || !isDirty} onClick={() => saveMutation.mutate()}><Save size={14} /> Save changes</Button>
          <Button variant="danger" disabled={isActive} onClick={() => setDeleteDialogOpen(true)}><Trash2 size={14} /> Delete</Button>
        </div>
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-[var(--vscode-border)] bg-[var(--vscode-sidebar)] p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide opacity-55">Add command</div>
        {commands.map((command) => <button key={command.id} type="button" disabled={isActive} onClick={() => addCommand(command)} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-[var(--vscode-list-hover)] disabled:opacity-45"><Plus size={12} className="shrink-0" /><span className="min-w-0 truncate">{command.name}</span></button>)}
        <div className="mt-5 border-t border-[var(--vscode-border)] pt-3 text-[10px] leading-4 opacity-60">Select a node, then use Remove node to take it out of the flow. A node can connect to multiple different nodes, but each pair can have only one connection.</div>
      </aside>
      <div className="min-w-0 flex-1"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodesDraggable={!isActive} nodesConnectable={!isActive} elementsSelectable={!isActive} fitView><Background gap={18} size={1} color="var(--vscode-border)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => node.data.status === "failed" ? "#f14c4c" : node.data.status === "running" ? "#89d185" : "#007acc"} /></ReactFlow></div>
    </div>
    {saveMutation.isError ? <div className="border-t border-[var(--vscode-danger)] bg-[color-mix(in_srgb,var(--vscode-danger)_12%,transparent)] px-3 py-2 text-[11px] text-[var(--vscode-danger)]">{saveMutation.error instanceof Error ? saveMutation.error.message : "Unable to save flow."}</div> : null}
    <FlowFormDialog mode="edit" open={editDialogOpen} projectName={project.name} flowName={flowName} isPending={editMutation.isPending} error={editMutation.error instanceof Error ? editMutation.error.message : null} onOpenChange={setEditDialogOpen} onSubmit={(name) => editMutation.mutate(name)} />
    <ConfirmDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="Delete flow" description={`Delete flow “${flow.name}”? This cannot be undone.`} confirmLabel="Delete flow" onConfirm={onDeleted} />
  </section>;
}
