import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_EXPLORER_PREFERENCES, getFileExplorerLayout, readFileExplorerPreferences } from "./file-explorer-preferences";

const read = (value: unknown) => readFileExplorerPreferences({ getItem: () => JSON.stringify(value) });

describe("Files panel preferences", () => {
  it("defaults to four expanded panels", () => {
    expect(read({})).toEqual(DEFAULT_FILE_EXPLORER_PREFERENCES);
    expect(getFileExplorerLayout(read({}), 600)).toEqual({ "file-tree": 40, "file-details": 20, "quick-access": 20, "project-twofa": 20 });
  });

  it("adds 2FA to a legacy layout while preserving pins and collapse preferences", () => {
    const quickAccess = [{ projectId: 1, relativePath: "src", name: "src", isDirectory: true }];
    const migrated = read({ quickAccess, detailsCollapsed: true, panelLayout: { "file-tree": 52, "file-details": 25, "quick-access": 23 } });
    expect(migrated.quickAccess).toEqual(quickAccess);
    expect(migrated.detailsCollapsed).toBe(true);
    expect(migrated.twofaCollapsed).toBe(false);
    expect(migrated.panelLayout["project-twofa"]).toBe(20);
    expect(migrated.panelLayout["file-tree"]).toBeCloseTo(41.6);
  });

  it("preserves collapse and expanded size when saved and reopened", () => {
    const saved = { ...read({}), twofaCollapsed: true, twofaExpandedSize: 26 };
    const restored = read(saved);
    expect(restored.twofaCollapsed).toBe(true);
    const collapsed = getFileExplorerLayout(restored, 500);
    expect(collapsed["project-twofa"]).toBe(6);
    expect(getFileExplorerLayout({ ...restored, twofaCollapsed: false }, 500)["project-twofa"]).toBeGreaterThanOrEqual(14);
    expect(restored.twofaExpandedSize).toBe(26);
  });

  it("fits large saved panel sizes while leaving at least 35% for files", () => {
    const preferences = read({ detailsExpandedSize: 70, quickAccessExpandedSize: 50, twofaExpandedSize: 60 });
    const layout = getFileExplorerLayout(preferences, 450);
    expect(layout["file-tree"]).toBeCloseTo(35);
    expect(layout["file-details"]).toBeGreaterThanOrEqual(18);
    expect(layout["quick-access"]).toBeGreaterThanOrEqual(14);
    expect(layout["project-twofa"]).toBeGreaterThanOrEqual(14);
    expect(Object.values(layout).reduce((sum, size) => sum + size, 0)).toBeCloseTo(100);
  });

  it("falls back from malformed preferences", () => {
    expect(readFileExplorerPreferences({ getItem: () => "{" })).toEqual(DEFAULT_FILE_EXPLORER_PREFERENCES);
    expect(read({ twofaExpandedSize: -1, panelLayout: { "project-twofa": "invalid" } }).twofaExpandedSize).toBe(20);
  });
});
