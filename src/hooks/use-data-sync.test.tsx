// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useDataSync } from "./use-data-sync";
import { DEFAULT_SYNC_SCOPES, applySyncPreferences, readSyncPreferences } from "../lib/data-sync";
import type { SyncPreview, SyncStatus } from "../lib/data-sync";

vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn()}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/api", () => ({ isDesktopRuntime: () => true, api: { pickProjectFolder: vi.fn() } }));
const initial: SyncStatus = { folder: "E:/USB", repository_id: "repo", scopes: DEFAULT_SYNC_SCOPES, last_synced_at: "2026-01-01T00:00:00Z", pending_preferences: {} };
const preview: SyncPreview = { session_id: "session", links: [], conflicts: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listen).mockResolvedValue(()=>{});
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, key: index => [...values.keys()][index] ?? null };
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
});
afterEach(cleanup);
function setup(status: SyncStatus = initial) {
  const open = vi.fn();const notify = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "sync_get_status") return status;
    if (command === "sync_prepare") return preview;
    if (command === "sync_commit") return { status: { ...status, last_synced_at: "2026-02-01T00:00:00Z" }, preferences: {} };
    return undefined;
  });
  const hook = renderHook(() => useDataSync(open, notify), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, open, notify };
}
describe("manual sync orchestration", () => {
  it("runs an MCP job using current preferences and reports completion",async()=>{
    const hook=setup();await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    localStorage.setItem("theme","light");
    const handler=vi.mocked(listen).mock.calls.find(([name])=>name==="mcp://sync-request")![1];
    act(()=>handler({event:"mcp://sync-request",id:0,payload:{id:"job-1"}}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith("mcp_sync_progress",{id:"job-1",state:"completed",errorCode:null}));
    expect(invoke).toHaveBeenCalledWith("sync_prepare",expect.objectContaining({mcpJobId:"job-1",preferences:expect.objectContaining({theme:"light"})}));
    expect(invoke).toHaveBeenCalledWith("sync_commit",expect.objectContaining({mcpJobId:"job-1"}));
  });
  it("keeps MCP conflict review in the existing dialog and reports cancellation",async()=>{
    const hook=setup();await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    const implementation=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async(command,args,options)=>command==="sync_prepare" ? {...preview,conflicts:[{id:"c",kind:"note",label:"Note",local:"a",remote:"b"}]} : implementation(command,args,options));
    const handler=vi.mocked(listen).mock.calls.find(([name])=>name==="mcp://sync-request")![1];
    act(()=>handler({event:"mcp://sync-request",id:0,payload:{id:"job-review"}}));
    await waitFor(()=>expect(hook.result.current.preview).not.toBeNull());
    expect(invoke).toHaveBeenCalledWith("mcp_sync_progress",{id:"job-review",state:"needs_review",errorCode:null});
    await act(()=>hook.result.current.cancel());
    expect(invoke).toHaveBeenCalledWith("sync_cancel",{sessionId:"session",mcpJobId:"job-review"});
    expect(invoke).toHaveBeenCalledWith("mcp_sync_progress",{id:"job-review",state:"cancelled",errorCode:null});
  });
  it("opens sync settings when no folder is configured without preparing a repository", async () => {
    const hook = setup({ ...initial, folder: null });await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.start());expect(hook.open).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "sync_prepare")).toHaveLength(0);
  });
  it("does not sync on mount and coalesces repeated clicks", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c).filter(c=>!c.startsWith("mcp_"))).toEqual(["sync_get_status"]);
    act(() => { hook.result.current.start();hook.result.current.start(); });
    await waitFor(() => expect(hook.result.current.status.last_synced_at).toBe("2026-02-01T00:00:00Z"));
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "sync_prepare")).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "sync_commit")).toHaveLength(1);
  });
  it("leaves the successful timestamp intact on a disconnected drive", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.mocked(invoke).mockRejectedValueOnce("Drive disconnected");act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.error).toBe("Drive disconnected"));
    expect(hook.result.current.status.last_synced_at).toBe(initial.last_synced_at);
  });
  it("cancels conflict review without committing a revision", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.mocked(invoke).mockResolvedValueOnce({ ...preview, conflicts: [{ id: "c", kind: "note", label: "Note", local: "a", remote: "b" }] });
    act(() => hook.result.current.start());await waitFor(() => expect(hook.result.current.preview?.conflicts).toHaveLength(1));
    await act(async () => { await hook.result.current.cancel(); });
    expect(hook.result.current.preview).toBeNull();
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "sync_commit")).toBe(false);
  });
  it("syncs only allowlisted preferences and immediately notifies their React owner", () => {
    localStorage.setItem("vscodeTabs", "local tabs");localStorage.setItem("defaultInteractiveTerminalKind", "wsl2");
    const listener = vi.fn();window.addEventListener("projects-runner:preferences-synced", listener);
    applySyncPreferences({ theme: "light", vscodeTabs: "remote tabs", defaultInteractiveTerminalKind: "cmd" });
    expect(localStorage.getItem("theme")).toBe("light");expect(localStorage.getItem("vscodeTabs")).toBe("local tabs");
    expect(localStorage.getItem("defaultInteractiveTerminalKind")).toBe("wsl2");expect(listener).toHaveBeenCalledOnce();
    expect(readSyncPreferences()).not.toHaveProperty("vscodeTabs");expect(readSyncPreferences()).not.toHaveProperty("defaultInteractiveTerminalKind");
    window.removeEventListener("projects-runner:preferences-synced", listener);
  });
  it("clears a failed commit so reconnecting the drive can start a fresh sync", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.mocked(invoke).mockResolvedValueOnce(preview).mockRejectedValueOnce("Drive disconnected during publication");
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.error).toBe("Drive disconnected during publication"));
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.status.last_synced_at).toBe(initial.last_synced_at);
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.status.last_synced_at).toBe("2026-02-01T00:00:00Z"));
  });
  it("does not reopen an expired review when preference acknowledgement fails after commit", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.mocked(invoke).mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ status: { ...initial, last_synced_at: "2026-02-01T00:00:00Z" }, preferences: { theme: "light" } })
      .mockRejectedValueOnce("Preference acknowledgement failed");
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.error).toBe("Preference acknowledgement failed"));
    expect(hook.result.current.preview).toBeNull();
    expect(localStorage.getItem("theme")).toBe("light");
    expect(hook.result.current.status.last_synced_at).toBe("2026-02-01T00:00:00Z");
  });
  it("clears an outdated review when preparing its replacement fails", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const conflicted = { ...preview, conflicts: [{ id: "c", kind: "note", label: "Note", local: "a", remote: "b" }] };
    vi.mocked(invoke).mockResolvedValueOnce(conflicted);
    act(() => hook.result.current.start());await waitFor(() => expect(hook.result.current.preview).not.toBeNull());
    vi.mocked(invoke).mockRejectedValueOnce("Local data changed while reviewing")
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce("Drive disconnected");
    await act(async () => { await hook.result.current.commit({ c: "local" }); });
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.error).toBe("Drive disconnected");
  });
  it("refreshes an outdated conflict preview before accepting another choice", async () => {
    const hook = setup();await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const conflicted = { ...preview, conflicts: [{ id: "c", kind: "note", label: "Note", local: "a", remote: "b" }] };
    vi.mocked(invoke).mockResolvedValueOnce(conflicted);
    act(() => hook.result.current.start());await waitFor(() => expect(hook.result.current.preview?.session_id).toBe("session"));
    vi.mocked(invoke).mockRejectedValueOnce("Local data changed while reviewing. Cancel and sync again to refresh the preview.")
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...conflicted, session_id: "fresh" });
    await act(async () => { await hook.result.current.commit({ c: "local" }); });
    expect(hook.result.current.preview?.session_id).toBe("fresh");expect(hook.result.current.error).toBeNull();
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "sync_commit")).toHaveLength(1);
  });
});
