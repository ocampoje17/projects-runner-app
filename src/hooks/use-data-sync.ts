import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, isDesktopRuntime } from "../lib/api";
import { applySyncPreferences, DEFAULT_SYNC_SCOPES, readSyncPreferences, syncApi, type SyncLink, type SyncPreview, type SyncScopes, type SyncStatus } from "../lib/data-sync";
import type { ToastInput } from "../components/motion/animated-toast-stack";

const INITIAL_STATUS: SyncStatus = { folder: null, repository_id: null, scopes: DEFAULT_SYNC_SCOPES, last_synced_at: null, pending_preferences: {} };
export function useDataSync(openSettings: () => void, notify: (toast: ToastInput) => unknown) {
  const client = useQueryClient();
  const [status, setStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [loading, setLoading] = useState(isDesktopRuntime());
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const session = useRef<string | null>(null);
  const mcpJob = useRef<string | null>(null);
  const mcpStart = useRef<(id: string) => void>(() => {});
  async function progress(state: string, errorCode: string | null = null) {
    const id=mcpJob.current; if (!id) return;
    await invoke("mcp_sync_progress", { id, state, errorCode });
    if (["completed","failed","cancelled"].includes(state)) mcpJob.current=null;
  }
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed=false;
    const heartbeat = () => { void invoke("mcp_sync_ready", { ready: !loading }).catch(() => {}); };
    const requests=listen<{id:string}>("mcp://sync-request", ({payload}) => mcpStart.current(payload.id));
    const cancelled=listen<string>("mcp://sync-cancelled", ({payload}) => { if (mcpJob.current===payload) {mcpJob.current=null;session.current=null;setPreview(null);setBusy(false);locked.current=false;} });
    void Promise.all([requests,cancelled]).then(() => { if (!disposed) heartbeat(); }).catch(e=>{if(!disposed)setError(String(e));});
    const timer=window.setInterval(heartbeat,10000);
    return () => {disposed=true;window.clearInterval(timer);void requests.then(fn=>fn()).catch(()=>{});void cancelled.then(fn=>fn()).catch(()=>{});void invoke("mcp_sync_ready", {ready:false}).catch(()=>{});};
  }, [loading]);

  async function acceptPreferences(preferences: Record<string, string>, expected?: Record<string, string>) {
    if (!Object.keys(preferences).length) return;
    const current = readSyncPreferences();
    applySyncPreferences(expected ? Object.fromEntries(Object.entries(preferences).filter(([key]) => current[key] === expected[key])) : preferences);
    await syncApi.acknowledge(preferences);
  }
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let alive = true;
    void syncApi.status().then(async next => {
      if (!alive) return;
      setStatus(next);
      await acceptPreferences(next.pending_preferences);
    }).catch(e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function fail(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    setError(message);
    notify({ title: "Data sync failed", description: message, status: "error" });
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { if(session.current){await syncApi.cancel(session.current,mcpJob.current).catch(()=>{});session.current=null;setPreview(null);} fail(e); await progress("failed", "SYNC_FAILED"); }
    finally { locked.current = false; setBusy(false); }
  }
  async function finish(next: SyncPreview, choices: Record<string, string>, refreshed = false) {
    const originalPreferences = readSyncPreferences();
    let result;
    try {
      result = await syncApi.commit(next.session_id, choices, originalPreferences, mcpJob.current);
    } catch (e) {
      const message = String(e);
      // A failed commit may already have published and expired its backend session.
      // Start the next attempt through prepare so recovery can inspect the journal.
      await syncApi.cancel(next.session_id, mcpJob.current).catch(() => {});
      session.current = null;
      setPreview(null);
      if (!refreshed && (message.includes("changed while reviewing") || message.includes("Local data changed"))) {
        const fresh = await syncApi.prepare(null, null, mcpJob.current);
        session.current = fresh.session_id;
        setPreview(fresh);
        notify({ title: "Sync preview refreshed", description: "Data changed while reviewing. Review the latest versions.", status: "info" });
        if (!fresh.links.length && !fresh.conflicts.length) await finish(fresh, {}, true);
        return;
      }
      throw e;
    }
    session.current = null;
    setPreview(null); setStatus(result.status);
    let preferenceError: unknown;
    try { await acceptPreferences(result.preferences, originalPreferences); } catch (e) { preferenceError = e; }
    await Promise.all([
      client.invalidateQueries({ queryKey: ["projects"] }),
      client.invalidateQueries({ queryKey: ["commands"] }),
      client.invalidateQueries({ queryKey: ["command-sections"] }),
      client.invalidateQueries({ queryKey: ["folder-dev-project-types"] }),
      client.invalidateQueries({ queryKey: ["all-folder-dev-project-types"] }),
      client.invalidateQueries({ queryKey: ["project-folder-dev-types-all"] }),
      client.invalidateQueries({ queryKey: ["twofa-accounts"] }),
    ]);
    window.dispatchEvent(new Event("projects-runner:data-synced"));
    if (preferenceError) throw preferenceError;
    await progress("completed");
    notify({ title: "Data synced", status: "success" });
  }
  async function handlePreview(next: SyncPreview) {
    session.current = next.session_id;
    if (next.links.length || next.conflicts.length) { setPreview(next); await progress("needs_review"); }
    else await finish(next, {});
  }
  mcpStart.current = (id: string) => {
    if (loading || busy || preview || locked.current) {void invoke("mcp_sync_progress",{id,state:"failed",errorCode:"SYNC_BUSY"}).catch(()=>{});return;}
    mcpJob.current=id;
    void run(async () => {await progress("running");await handlePreview(await syncApi.prepare(null,null,id));});
  };
  return {
    status, loading, busy, preview, error,
    start: () => {
      if (loading || busy || preview) return;
      if (!status.folder) { openSettings(); return; }
      void run(async () => handlePreview(await syncApi.prepare(null, null, mcpJob.current)));
    },
    chooseFolder: () => run(async () => {
      const folder = await api.pickProjectFolder();
      if (folder) setStatus(await syncApi.configure(folder, status.scopes));
    }),
    configureScopes: (scopes: SyncScopes) => run(async () => { setStatus(await syncApi.configure(null, scopes)); }),
    link: (links: SyncLink[]) => run(async () => {
      if (preview) await handlePreview(await syncApi.prepare(links, preview.session_id, mcpJob.current));
    }),
    commit: (choices: Record<string, string>) => run(async () => { if (preview) await finish(preview, choices); }),
    cancel: () => run(async () => {
      if (session.current) await syncApi.cancel(session.current, mcpJob.current);
      session.current = null; setPreview(null); setError(null);
      await progress("cancelled");
    }),
  };
}
export type DataSyncController = ReturnType<typeof useDataSync>;
