import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import type { DataSyncController } from "../hooks/use-data-sync";
import { changeSyncScope, SYNC_GROUPS, type SyncConflict } from "../lib/data-sync";
import { formatDateTime } from "../lib/date-time";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip } from "./motion/tooltip";
import { EntityAvatar } from "./entity-avatar";

export function SyncTitlebarButton({ sync }: { sync: DataSyncController }) {
  const last = sync.status.last_synced_at;
  const tooltip = sync.busy ? "Syncing data…" : last ? `Last synced: ${formatDateTime(last)}` : "Data sync · Never synced";
  const empty = !Object.values(sync.status.scopes).some(Boolean);
  return <Tooltip content={tooltip} side="bottom" wrapperClassName="flex shrink-0" >
    <button type="button" data-titlebar-interactive="true" aria-label={sync.busy ? "Syncing data" : "Sync data"}
      aria-busy={sync.busy} disabled={sync.loading || sync.busy || !!sync.preview || (!!sync.status.folder && empty)}
      onClick={sync.start} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      className="app-focus-ring flex h-6 w-7 items-center justify-center rounded-[4px] border border-transparent text-[var(--vscode-icon)] transition-colors hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground disabled:opacity-50">
      <RefreshCw size={14} className={sync.busy ? "animate-spin motion-reduce:animate-none" : undefined} />
    </button>
  </Tooltip>;
}

export function SyncSettingsPanel({ sync }: { sync: DataSyncController }) {
  const disabled = sync.busy || sync.loading || !!sync.preview;
  return <section className="mb-6 min-w-0">
    <div className="flex items-center gap-2.5 border-b border-[var(--vscode-border)] pb-3 text-primary">
      <RefreshCw size={16} /><h3 className="text-[14px] font-semibold text-foreground">Data Sync</h3>
    </div>
    <div className="flex items-center justify-between gap-4 border-b border-[var(--vscode-border)] py-4">
      <div className="min-w-0"><h4 className="text-[12.5px] font-semibold">Sync folder</h4>
        <p className="mt-1 break-all text-[12px] text-muted-foreground">{sync.status.folder ?? "No folder selected"}</p></div>
      <Button variant="outline" disabled={disabled} onClick={() => void sync.chooseFolder()}><FolderOpen size={13} />{sync.status.folder ? "Change folder" : "Choose folder"}</Button>
    </div>
    {SYNC_GROUPS.map(([key, label]) => <div key={key} className="flex items-center justify-between border-b border-[var(--vscode-border)] py-3">
      <label htmlFor={`sync-${key}`} className="cursor-pointer text-[12.5px]">{label}</label>
      <Checkbox id={`sync-${key}`} aria-label={label} checked={sync.status.scopes[key]} disabled={disabled || !sync.status.folder}
        onCheckedChange={checked => void sync.configureScopes(changeSyncScope(sync.status.scopes, key, checked))} />
    </div>)}
    <div className="mt-4 flex items-center justify-between gap-4">
      <span className="text-[12px] text-muted-foreground">Last synced: {sync.status.last_synced_at ? formatDateTime(sync.status.last_synced_at) : "Never"}</span>
      <Button disabled={disabled || !sync.status.folder || !Object.values(sync.status.scopes).some(Boolean)} onClick={sync.start}>
        <RefreshCw size={13} className={sync.busy ? "animate-spin motion-reduce:animate-none" : undefined} />{sync.busy ? "Syncing…" : "Sync now"}
      </Button>
    </div>
    {sync.error && <p role="alert" className="mt-3 text-[12px] text-destructive">{sync.error}</p>}
  </section>;
}

const fieldLabels: Record<string, string> = {
  name: "Name", description: "Description", title: "Title", content: "Content", script: "Script", ports: "Ports", section: "Group",
  order_index: "Order", runtime_mode: "Run mode", run_in_external_terminal: "External terminal", external_terminal_kind: "External terminal type",
  interactive_terminal_kind: "Interactive terminal", created_at: "Created", updated_at: "Updated", createdAt: "Created", updatedAt: "Updated",
  pinned: "Pinned", folder_types: "Folder types", changed_contents: "Changed contents", key: "Preference", value: "Value", icon: "Icon",
  theme: "Theme", accent: "Accent color", dateFormat: "Date format", terminalFontSize: "Terminal font size", terminalFontFamily: "Terminal font",
  autoClearLogs: "Auto-clear logs", showLogsTimestamp: "Log timestamps", showStreamName: "Stream names", explorerAllowMultipleOpen: "Multiple explorer items", restoreOpenTabs: "Restore open tabs",
};
function readableVersion(data: Record<string, unknown>): string {
  return Object.entries(data).filter(([key]) => !["owner", "owner_kind", "sha256", "preview"].includes(key)).map(([key, value]) => {
    let shown: string;
    if (key === "changed_contents" && Array.isArray(value)) shown = value.map(item => readableVersion(item as Record<string, unknown>)).join("\n\n");
    else if (key === "folder_types" && Array.isArray(value)) shown = value.map(item => `${item.relative_path || "."}: ${item.project_type_id}`).join(", ") || "None";
    else if (["created_at", "updated_at", "createdAt", "updatedAt"].includes(key) && typeof value === "string" && Number.isFinite(Date.parse(value))) shown = formatDateTime(value);
    else if (typeof value === "boolean") shown = value ? "Yes" : "No";
    else if (key === "key" && typeof value === "string") shown = fieldLabels[value] ?? value;
    else if (key === "runtime_mode") shown = ({ internal_headless: "Background", internal_interactive: "Interactive", external_terminal: "External terminal" } as Record<string, string>)[String(value)] ?? String(value);
    else shown = value == null ? "—" : String(value);
    return `${fieldLabels[key] ?? key}: ${shown}`;
  }).join("\n");
}
function Version({ conflict, side, selected, disabled, onSelect }: { conflict: SyncConflict; side: "local" | "remote"; selected: boolean; disabled: boolean; onSelect: () => void }) {
  const raw = conflict[side];
  let value = raw;
  let data: Record<string, unknown> | null = null;
  try { data = raw === null ? null : JSON.parse(raw); value = data ? readableVersion(data) : null; } catch { /* Display the original representation. */ }
  return <button type="button" aria-pressed={selected} disabled={disabled} onClick={onSelect}
    className={`app-focus-ring flex min-w-0 flex-col gap-2 rounded-[5px] border p-3 text-left ${selected ? "border-primary bg-[var(--vscode-list-active)]" : "border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)]"}`}>
    <span className="text-[12px] font-medium">{side === "local" ? "This device" : "Sync folder"}{selected ? " ✓" : ""}</span>
    {typeof data?.preview === "string" && data.preview.startsWith("data:image/") && <img src={data.preview} alt="Avatar version" className="h-16 w-16 rounded-[6px] object-contain" />}
    {typeof data?.icon === "string" && <EntityAvatar name="Avatar" path={data.icon} className="h-12 w-12" />}
    <pre className="max-h-44 w-full overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{value ?? "Deleted"}</pre>
  </button>;
}

export function SyncReviewDialog({ sync }: { sync: DataSyncController }) {
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  useEffect(() => { setMatches({}); setChoices({}); }, [sync.preview?.session_id]);
  const preview = sync.preview;
  if (!preview) return null;
  const linking = preview.links.length > 0;
  const localProjects = [...new Map(preview.links.map(link => [link.local_id, link])).values()];
  return <Dialog open onOpenChange={open => { if (!open && !sync.busy) void sync.cancel(); }}>
    <DialogContent className="w-[min(820px,calc(100vw-24px))]" onEscapeKeyDown={e => { if (sync.busy) e.preventDefault(); }} onInteractOutside={e => { if (sync.busy) e.preventDefault(); }}>
      <DialogHeader><DialogTitle>{linking ? "Match existing projects" : "Review sync conflicts"}</DialogTitle>
        <DialogDescription>{linking ? "Choose projects to link with the sync folder." : "Choose which version to keep for each conflict."}</DialogDescription></DialogHeader>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {linking ? localProjects.map(local => <div key={local.local_id} className="grid grid-cols-2 items-center gap-3 border-b border-[var(--vscode-border)] py-3">
          <span className="min-w-0 break-all text-[12px]">{local.local_label}</span>
          <Select value={matches[local.local_id] ?? "separate"} disabled={sync.busy} onValueChange={value => setMatches(current => ({ ...current, [local.local_id]: value }))}>
            <SelectTrigger aria-label={`Match ${local.local_label}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="separate">Keep as separate project</SelectItem>
              {preview.links.filter(link => link.local_id === local.local_id).map(link => <SelectItem key={link.remote_id} value={link.remote_id}
                disabled={Object.entries(matches).some(([lid, rid]) => lid !== local.local_id && rid === link.remote_id)}>{link.remote_label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>) : <>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={sync.busy} onClick={() => setChoices(Object.fromEntries(preview.conflicts.map(c => [c.id, "local"])))}>Use all from this device</Button>
            <Button variant="outline" disabled={sync.busy} onClick={() => setChoices(Object.fromEntries(preview.conflicts.map(c => [c.id, "remote"])))}>Use all from sync folder</Button></div>
          {preview.conflicts.map(conflict => <section key={conflict.id}>
            <h4 className="mb-2 text-[12.5px] font-semibold">{conflict.label}</h4>
            <div className="grid grid-cols-2 gap-3">{(["local", "remote"] as const).map(side => <Version key={side} conflict={conflict} side={side} selected={choices[conflict.id] === side}
              disabled={sync.busy} onSelect={() => setChoices(current => ({ ...current, [conflict.id]: side }))} />)}</div>
          </section>)}
        </>}
      </div>
      {sync.error && <p role="alert" className="mt-3 text-[12px] text-destructive">{sync.error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={sync.busy} onClick={() => void sync.cancel()}>Cancel</Button>
        <Button disabled={sync.busy || (!linking && preview.conflicts.some(c => !choices[c.id]))} onClick={() => {
          if (linking) void sync.link(Object.entries(matches).filter(([,rid]) => rid !== "separate").map(([local_id, remote_id]) => ({ local_id, remote_id })));
          else void sync.commit(choices);
        }}>{sync.busy ? "Syncing…" : linking ? "Continue" : "Sync selected versions"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
