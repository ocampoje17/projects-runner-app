import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, type DevCacheCandidate, type DevCacheCleanResult, type DevProjectType, type DevProjectTypeScan, type Project } from "../lib/api";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export type DevProjectToolsRequest = { mode: "types" | "clean"; relativePath: string } | null;

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  return `${(value / 1024 ** (unit + 1)).toFixed(1)} ${units[unit]}`;
}

export function DevProjectToolsDialogs({ project, request, onRequestChange, onCleaned }: {
  project: Project;
  request: DevProjectToolsRequest;
  onRequestChange: (request: DevProjectToolsRequest) => void;
  onCleaned: () => void;
}) {
  const [types, setTypes] = useState<DevProjectType[]>([]);
  const [scan, setScan] = useState<DevProjectTypeScan | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [isSavingTypes, setIsSavingTypes] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DevCacheCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [isScanningCache, setIsScanningCache] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<DevCacheCleanResult | null>(null);
  const [continueToClean, setContinueToClean] = useState(false);

  const path = request?.relativePath ?? "";
  const displayPath = path || project.name;

  const loadTypes = useCallback(async (preselectDetected: boolean) => {
    setIsLoadingTypes(true);
    setTypeError(null);
    try {
      const [catalog, detected, stored] = await Promise.all([
        api.listDevProjectTypes(),
        api.scanDevProjectTypes(project.id, path),
        api.getFolderDevProjectTypes(project.id, path),
      ]);
      setTypes(catalog);
      setScan(detected);
      setSelectedTypes(new Set(stored.length > 0 || !preselectDetected ? stored : detected.detected_type_ids));
    } catch (error) {
      setTypeError(error instanceof Error ? error.message : "Unable to scan project types.");
    } finally {
      setIsLoadingTypes(false);
    }
  }, [path, project.id]);

  const loadCache = useCallback(async () => {
    setIsScanningCache(true);
    setCleanError(null);
    setCleanResult(null);
    try {
      const next = await api.scanDevCache(project.id, path);
      setCandidates(next);
      setSelectedCandidates(new Set(next.map((item) => item.id)));
    } catch (error) {
      setCleanError(error instanceof Error ? error.message : "Unable to scan development cache.");
    } finally {
      setIsScanningCache(false);
    }
  }, [path, project.id]);

  useEffect(() => {
    if (!request) return;
    setSearch("");
    if (request.mode === "types") {
      void loadTypes(true);
      return;
    }
    void api.getFolderDevProjectTypes(project.id, request.relativePath).then((stored) => {
      if (stored.length === 0) {
        setContinueToClean(true);
        onRequestChange({ mode: "types", relativePath: request.relativePath });
      } else {
        setContinueToClean(false);
        void loadCache();
      }
    }).catch((error) => setCleanError(error instanceof Error ? error.message : "Unable to load project types."));
  }, [loadCache, loadTypes, onRequestChange, project.id, request]);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = types.filter((item) => !query || `${item.label} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query));
    return [...new Set(filtered.map((item) => item.category))].map((category) => ({ category, items: filtered.filter((item) => item.category === category) }));
  }, [search, types]);

  const saveTypes = async () => {
    setIsSavingTypes(true);
    setTypeError(null);
    try {
      const saved = await api.setFolderDevProjectTypes(project.id, path, [...selectedTypes]);
      if (continueToClean && saved.length > 0) {
        setContinueToClean(false);
        onRequestChange({ mode: "clean", relativePath: path });
      } else {
        setContinueToClean(false);
        onRequestChange(null);
      }
    } catch (error) {
      setTypeError(error instanceof Error ? error.message : "Unable to save project types.");
    } finally {
      setIsSavingTypes(false);
    }
  };

  const clean = async () => {
    if (selectedCandidates.size === 0) return;
    setIsCleaning(true);
    setCleanError(null);
    try {
      const result = await api.cleanDevCache(project.id, path, [...selectedCandidates]);
      setCleanResult(result);
      onCleaned();
      const next = await api.scanDevCache(project.id, path);
      setCandidates(next);
      setSelectedCandidates(new Set(next.map((item) => item.id)));
    } catch (error) {
      setCleanError(error instanceof Error ? error.message : "Unable to clean development cache.");
    } finally {
      setIsCleaning(false);
    }
  };

  const selectedBytes = candidates.filter((item) => selectedCandidates.has(item.id)).reduce((total, item) => total + item.size_bytes, 0);
  const close = () => { setContinueToClean(false); onRequestChange(null); };

  return (
    <>
      <Dialog open={request?.mode === "types"} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="w-[min(720px,calc(100vw-20px))] overflow-hidden p-0">
          <div className="p-4">
            <DialogHeader><DialogTitle>Set Dev Project Type</DialogTitle><DialogDescription>Select every technology used by “{displayPath}”. Detected types are suggestions only.</DialogDescription></DialogHeader>
            <div className="mb-3 flex gap-2"><div className="relative flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project types" className="pl-8" /></div><Button variant="secondary" onClick={() => void loadTypes(false)} disabled={isLoadingTypes}><RefreshCw size={14} className={isLoadingTypes ? "animate-spin" : ""} />Rescan</Button></div>
            {typeError ? <div className="mb-2 text-[12px] text-[var(--vscode-danger)]">{typeError}</div> : null}
            <div className="max-h-[55vh] overflow-y-auto rounded-[6px] border border-[var(--vscode-border)]">
              {isLoadingTypes && types.length === 0 ? <div className="flex items-center justify-center gap-2 p-8 text-[12px] text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />Scanning project types…</div> : filteredGroups.map((group) => <div key={group.category}><div className="sticky top-0 z-10 border-b border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{group.category}</div>{group.items.map((item) => { const checked = selectedTypes.has(item.id); const evidence = scan?.evidence[item.id] ?? []; return <button key={item.id} type="button" onClick={() => setSelectedTypes((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="flex w-full items-start gap-3 border-b border-[var(--vscode-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--vscode-list-hover)]"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-[var(--vscode-border)]"}`}>{checked ? <Check size={12} /> : null}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[12px] font-medium text-foreground">{item.label}{evidence.length ? <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase text-primary">Detected</span> : null}</span><span className="block text-[11px] text-muted-foreground">{item.description}</span>{evidence.length ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{evidence.join(" · ")}</span> : null}</span></button>; })}</div>)}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-4 py-3"><span className="text-[11px] text-muted-foreground">{selectedTypes.size} type{selectedTypes.size === 1 ? "" : "s"} selected</span><div className="flex gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => void saveTypes()} disabled={isSavingTypes || (continueToClean && selectedTypes.size === 0)}>{isSavingTypes ? <LoaderCircle size={14} className="animate-spin" /> : null}{continueToClean ? "Save & Continue" : "Save"}</Button></div></div>
        </DialogContent>
      </Dialog>

      <Dialog open={request?.mode === "clean"} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="w-[min(680px,calc(100vw-20px))] overflow-hidden p-0">
          <div className="p-4">
            <DialogHeader><DialogTitle>Clean Dev Cache</DialogTitle><DialogDescription>Select generated cache and build folders to remove from “{displayPath}”. Dependencies are never included.</DialogDescription></DialogHeader>
            <div className="mb-3 flex items-center justify-between"><span className="text-[12px] text-muted-foreground">{selectedCandidates.size} selected · {formatBytes(selectedBytes)}</span><Button variant="secondary" onClick={() => void loadCache()} disabled={isScanningCache || isCleaning}><RefreshCw size={14} className={isScanningCache ? "animate-spin" : ""} />Rescan</Button></div>
            {cleanError ? <div className="mb-2 text-[12px] text-[var(--vscode-danger)]">{cleanError}</div> : null}
            {cleanResult ? <div className={`mb-2 rounded border px-3 py-2 text-[11px] ${cleanResult.failed_items.length ? "border-[var(--vscode-danger)]/40 text-[var(--vscode-danger)]" : "border-success/40 text-success"}`}>Freed {formatBytes(cleanResult.freed_bytes)}.{cleanResult.failed_items.length ? ` ${cleanResult.failed_items.length} item(s) could not be removed: ${cleanResult.failed_items.map((item) => `${item.relative_path || item.id}: ${item.error}`).join("; ")}` : ""}</div> : null}
            <div className="max-h-[52vh] overflow-y-auto rounded-[6px] border border-[var(--vscode-border)]">
              {isScanningCache && candidates.length === 0 ? <div className="flex items-center justify-center gap-2 p-8 text-[12px] text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />Scanning generated folders…</div> : candidates.length === 0 ? <div className="p-8 text-center text-[12px] text-muted-foreground">No generated cache or build folders found.</div> : candidates.map((item) => { const checked = selectedCandidates.has(item.id); return <button key={item.id} type="button" onClick={() => setSelectedCandidates((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="flex w-full items-center gap-3 border-b border-[var(--vscode-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--vscode-list-hover)]"><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-[var(--vscode-border)]"}`}>{checked ? <Check size={12} /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px] text-foreground">{item.relative_path}</span><span className="block text-[10px] text-muted-foreground">{item.project_type_ids.join(", ")}</span></span><span className="shrink-0 text-right text-[11px] text-muted-foreground">{formatBytes(item.size_bytes)}<span className="block text-[10px]">{item.file_count.toLocaleString()} files</span></span></button>; })}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-4 py-3"><Button variant="ghost" onClick={close}>Close</Button><Button variant="danger" onClick={() => void clean()} disabled={isCleaning || selectedCandidates.size === 0}><Trash2 size={14} />{isCleaning ? "Cleaning…" : "Clean"}{isCleaning ? <LoaderCircle size={14} className="animate-spin" /> : null}</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
