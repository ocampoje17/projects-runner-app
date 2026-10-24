// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SyncReviewDialog, SyncSettingsPanel, SyncTitlebarButton } from "./data-sync";
import type { DataSyncController } from "../hooks/use-data-sync";
import { changeSyncScope, DEFAULT_SYNC_SCOPES } from "../lib/data-sync";
import { readSavedSettingsSection, writeSavedSettingsSection } from "../lib/sidebar-state";

vi.mock("./motion/tooltip", () => ({ Tooltip: ({ children, content }: { children: React.ReactNode; content: string }) => <span title={content}>{children}</span> }));
beforeEach(() => {
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, key: index => [...values.keys()][index] ?? null };
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(cleanup);
function controller(overrides: Partial<DataSyncController> = {}): DataSyncController {
  return {
    status: { folder: "E:/USB", repository_id: "repo", scopes: DEFAULT_SYNC_SCOPES, last_synced_at: null, pending_preferences: {} },
    loading: false, busy: false, preview: null, error: null,
    start: vi.fn(), chooseFolder: vi.fn(async () => {}), configureScopes: vi.fn(async () => {}),
    link: vi.fn(async () => {}), commit: vi.fn(async () => {}), cancel: vi.fn(async () => {}), ...overrides,
  };
}
describe("Data Sync UI", () => {
  it("defaults to all groups and enforces the project dependency", () => {
    expect(Object.values(DEFAULT_SYNC_SCOPES).every(Boolean)).toBe(true);
    const off = changeSyncScope(DEFAULT_SYNC_SCOPES, "projects", false);
    expect(off).toEqual({ projects: false, commands: false, notes: false, avatars: false, preferences: true });
    expect(changeSyncScope(off, "notes", true)).toEqual({ ...off, projects: true, notes: true });
  });
  it("persists navigation to the new settings section", () => {
    writeSavedSettingsSection("sync");
    expect(readSavedSettingsSection()).toBe("sync");
  });
  it("shows the folder, five enabled groups, and never-synced state", () => {
    render(<SyncSettingsPanel sync={controller()} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("E:/USB")).toBeTruthy();
    expect(screen.getByText("Last synced: Never")).toBeTruthy();
  });
  it("disables sync when all groups are excluded and prevents titlebar drag", () => {
    const start = vi.fn();
    const sync = controller({ start, status: { ...controller().status, scopes: { projects: false, commands: false, notes: false, avatars: false, preferences: false } } });
    const parentDown = vi.fn();
    const { rerender } = render(<div onMouseDown={parentDown}><SyncTitlebarButton sync={sync} /><SyncSettingsPanel sync={sync} /></div>);
    expect((screen.getByRole("button", { name: "Sync data" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<div onMouseDown={parentDown}><SyncTitlebarButton sync={controller({ start })} /></div>);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Sync data" }));
    expect(parentDown).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
  });
  it("requires an explicit conflict choice and offers deleted versions", () => {
    const sync = controller({ preview: { session_id: "s", links: [], conflicts: [{ id: "c", kind: "command", label: "Dev", local: null, remote: '{"script":"npm run dev"}' }] } });
    render(<SyncReviewDialog sync={sync} />);
    const commit = screen.getByRole("button", { name: "Sync selected versions" }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);expect(screen.getByText("Deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /This device/ }));
    expect(commit.disabled).toBe(false);fireEvent.click(commit);
    expect(sync.commit).toHaveBeenCalledWith({ c: "local" });
  });
  it("does not automatically link same-name projects and can cancel", () => {
    const sync = controller({ preview: { session_id: "s", conflicts: [], links: [{ local_id: "a", remote_id: "b", local_label: "App", remote_label: "App" }] } });
    render(<SyncReviewDialog sync={sync} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));expect(sync.link).toHaveBeenCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));expect(sync.cancel).toHaveBeenCalled();
  });
});
