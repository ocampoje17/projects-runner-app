import { useMemo, useState } from "react";
import { CircleStop, GitBranch, Play, Plus, Search, Trash2, X } from "lucide-react";
import type { Project, ProjectFlow } from "../lib/api";
import type { FlowRunState } from "../hooks/use-flow-runtime";
import { formatDateTime } from "../lib/date-time";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./process-dialogs";

function flowStatusLabel(state: FlowRunState | undefined) {
  switch (state?.status) {
    case "starting": return "Starting";
    case "running": return "Running";
    case "degraded": return "Degraded";
    case "completed": return "Completed";
    case "stopped": return "Stopped";
    case "failed": return "Failed";
    default: return "Ready";
  }
}

export function FlowsOverviewPane({ project, flows, flowRuns, onCreate, onOpen, onRun, onStop, onDelete }: {
  project: Project;
  flows: ProjectFlow[];
  flowRuns: Record<number, FlowRunState>;
  onCreate: () => void;
  onOpen: (flow: ProjectFlow) => void;
  onRun: (flow: ProjectFlow) => void;
  onStop: (flow: ProjectFlow) => void;
  onDelete: (flow: ProjectFlow) => void;
}) {
  const [query, setQuery] = useState("");
  const [flowToDelete, setFlowToDelete] = useState<ProjectFlow | null>(null);
  const visibleFlows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return flows.filter((flow) => !normalized || flow.name.toLocaleLowerCase().includes(normalized));
  }, [flows, query]);

  return <div className="min-h-0 flex-1 overflow-auto bg-[var(--vscode-editor)] p-6">
    <div className="mx-auto flex min-h-full max-w-[1220px] flex-col">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-[20px] font-semibold text-foreground">{project.name} Flows</h2><p className="mt-1 text-[12px] text-[var(--vscode-foreground)]/64">{flows.length} saved {flows.length === 1 ? "flow" : "flows"} for this project.</p></div>
        <Button type="button" variant="primary" size="md" onClick={onCreate}><Plus size={14} /> New flow</Button>
      </header>
      <div className="mb-5 flex max-w-md items-center gap-2 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-2"><Search size={14} className="opacity-60" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search flows" className="h-8 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--vscode-foreground)]/45" />{query ? <button type="button" onClick={() => setQuery("")} className="p-1 opacity-65 hover:opacity-100" aria-label="Clear search"><X size={13} /></button> : null}</div>
      {flows.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--vscode-border)] p-10 text-center"><GitBranch size={28} className="mb-3 opacity-50" /><h3 className="text-[14px] font-medium">No flows yet</h3><p className="mt-1 max-w-sm text-[12px] text-[var(--vscode-foreground)]/62">Create a flow to launch this project’s commands in a reusable order.</p><button type="button" onClick={onCreate} className="flow-toolbar-button mt-4 border border-[var(--vscode-border)]"><Plus size={13} /> Create first flow</button></div> : visibleFlows.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] p-10 text-center text-[12px] text-[var(--vscode-foreground)]/62">No flow matches “{query}”. <button type="button" onClick={() => setQuery("")} className="underline underline-offset-2">Clear search</button></div> : <div className="grid gap-3 lg:grid-cols-2">{visibleFlows.map((flow) => {
        const state = flowRuns[flow.id]; const active = ["starting", "running", "degraded"].includes(state?.status ?? "idle");
        return <article key={flow.id} className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-4 transition-colors hover:bg-[var(--vscode-list-hover)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><GitBranch size={15} className="shrink-0 opacity-70" /><h3 className="truncate text-[13px] font-semibold">{flow.name}</h3></div><p className="mt-2 text-[11px] text-[var(--vscode-foreground)]/64">{flow.node_count ?? 0} command nodes · Updated {formatDateTime(flow.updated_at)}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${state?.status === "failed" || state?.status === "degraded" ? "bg-[color-mix(in_srgb,var(--vscode-danger)_16%,transparent)] text-[var(--vscode-danger)]" : active ? "bg-[color-mix(in_srgb,var(--success-color)_16%,transparent)] text-[var(--success-color)]" : "bg-[var(--vscode-list-hover)]"}`}>{flowStatusLabel(state)}</span></div><div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={() => onOpen(flow)} className="flow-toolbar-button border border-[var(--vscode-border)]">Open</button>{active ? <button type="button" onClick={() => onStop(flow)} className="flow-toolbar-button border border-[var(--vscode-border)]"><CircleStop size={13} /> Stop</button> : <button type="button" onClick={() => onRun(flow)} className="flow-toolbar-button border border-[var(--vscode-border)]"><Play size={13} /> Run</button>}<button type="button" onClick={() => setFlowToDelete(flow)} disabled={active} className="flow-toolbar-button ml-auto text-[var(--vscode-danger)] disabled:opacity-40"><Trash2 size={13} /></button></div></article>;
      })}</div>}
      <ConfirmDialog open={flowToDelete !== null} onOpenChange={(open) => { if (!open) setFlowToDelete(null); }} title="Delete flow" description={`Delete flow “${flowToDelete?.name ?? ""}”? This cannot be undone.`} confirmLabel="Delete flow" onConfirm={() => { if (flowToDelete) onDelete(flowToDelete); }} />
    </div>
  </div>;
}
