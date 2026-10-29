import { describe, expect, it, beforeEach } from "vitest";
import {
  getAncestorPaths,
  readSavedActiveTabId,
  readSavedPinnedTabIds,
  readSavedProjectFilesExpandedPaths,
  readSavedProjectFilesSelectedPath,
  readSavedSelectedProjectId,
  readSavedTabs,
  readExpandedProjectIds,
  readTreeExpandedState,
  resolveClosestExistingPath,
  toggleProjectExpansion,
  sanitizeTabs,
  writeSavedActiveTabId,
  writeSavedPinnedTabIds,
  writeSavedProjectFilesExpandedPaths,
  writeSavedProjectFilesSelectedPath,
  writeSavedSelectedProjectId,
  writeSavedTabs,
  writeExpandedProjectIds,
  writeTreeExpandedState,
  migrateLocalStorageTwofaState,
  type EditorTab,
} from "./sidebar-state";
import type { Project, ProjectCommand } from "./api";

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
}

describe("sidebar-state helpers", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
  });

  describe("selectedProjectId persistence", () => {
    it("returns null when nothing is saved", () => {
      expect(readSavedSelectedProjectId(mockStorage)).toBeNull();
    });

    it("saves and reads selectedProjectId", () => {
      writeSavedSelectedProjectId(42, mockStorage);
      expect(readSavedSelectedProjectId(mockStorage)).toBe(42);
    });

    it("ignores invalid values", () => {
      mockStorage.setItem("selectedProjectId", "invalid");
      expect(readSavedSelectedProjectId(mockStorage)).toBeNull();
    });
  });

  describe("tabs persistence", () => {
    it("returns null when no tabs saved", () => {
      expect(readSavedTabs(mockStorage)).toBeNull();
    });

    it("saves and reads tabs correctly", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Project 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
      ];
      writeSavedTabs(tabs, mockStorage);
      expect(readSavedTabs(mockStorage)).toEqual(tabs);
    });

    it("restores all tabs when restoreAll is true", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Project 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
      ];
      writeSavedTabs(tabs, mockStorage);
      writeSavedPinnedTabIds(new Set(["command:10"]), mockStorage);
      expect(readSavedTabs(mockStorage, true)).toEqual(tabs);
    });

    it("restores only pinned tabs when restoreAll is false and preserves pinned tabs", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Project 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
        { id: "note:5", kind: "note", projectId: 1, noteId: "5", title: "Note 5" },
      ];
      writeSavedTabs(tabs, mockStorage);
      writeSavedPinnedTabIds(new Set(["command:10", "note:5"]), mockStorage);

      const restored = readSavedTabs(mockStorage, false);
      expect(restored).toEqual([
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
        { id: "note:5", kind: "note", projectId: 1, noteId: "5", title: "Note 5" },
      ]);
    });

    it("returns null when restoreAll is false and there are no pinned tabs", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Project 1" },
      ];
      writeSavedTabs(tabs, mockStorage);
      expect(readSavedTabs(mockStorage, false)).toBeNull();
    });

    it("reads active tab and pinned tabs", () => {
      writeSavedActiveTabId("command:10", mockStorage);
      expect(readSavedActiveTabId(mockStorage)).toBe("command:10");

      writeSavedPinnedTabIds(new Set(["command:10", "note:5"]), mockStorage);
      expect(readSavedPinnedTabIds(mockStorage)).toEqual(new Set(["command:10", "note:5"]));
    });

    it("filters active tab if not in validTabIds", () => {
      writeSavedActiveTabId("command:10", mockStorage);
      expect(readSavedActiveTabId(mockStorage, new Set(["note:5"]))).toBeNull();
      expect(readSavedActiveTabId(mockStorage, new Set(["command:10"]))).toBe("command:10");
    });

    it("preserves activeTabId among multiple restored tabs", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Project 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
        { id: "command:20", kind: "command", projectId: 1, commandId: 20, title: "Dev" },
      ];
      writeSavedTabs(tabs, mockStorage);
      writeSavedActiveTabId("command:20", mockStorage);

      const restoredTabs = readSavedTabs(mockStorage, true);
      const validIds = new Set(restoredTabs?.map((t) => t.id));
      const restoredActiveId = readSavedActiveTabId(mockStorage, validIds);

      expect(restoredTabs).toEqual(tabs);
      expect(restoredActiveId).toBe("command:20");
    });
  });

  describe("project expansion toggle", () => {
    it("toggles in multi-open mode", () => {
      let expanded = new Set<number>([1]);
      expanded = toggleProjectExpansion(expanded, 2, true);
      expect(expanded).toEqual(new Set([1, 2]));

      expanded = toggleProjectExpansion(expanded, 1, true);
      expect(expanded).toEqual(new Set([2]));
    });

    it("toggles in single-open (accordion) mode", () => {
      let expanded = new Set<number>([1]);
      // Clicking another project replaces the expanded set
      expanded = toggleProjectExpansion(expanded, 2, false);
      expect(expanded).toEqual(new Set([2]));

      // Clicking the currently expanded project collapses it to empty
      expanded = toggleProjectExpansion(expanded, 2, false);
      expect(expanded).toEqual(new Set([]));

      // Clicking a project when empty expands that project
      expanded = toggleProjectExpansion(expanded, 3, false);
      expect(expanded).toEqual(new Set([3]));
    });

    it("saves and reads expanded project IDs in both modes", () => {
      writeExpandedProjectIds(new Set([1, 3]), mockStorage);
      expect(readExpandedProjectIds(mockStorage)).toEqual(new Set([1, 3]));

      writeExpandedProjectIds(new Set([]), mockStorage);
      expect(readExpandedProjectIds(mockStorage)).toEqual(new Set([]));
    });
  });

  describe("tree expanded state", () => {
    it("reads and writes tree expanded state", () => {
      const state = { "commands:1": false, "twofa:1": true, "section:1:2": false };
      writeTreeExpandedState(state, mockStorage);
      expect(readTreeExpandedState(mockStorage)).toEqual(state);
    });
  });

  describe("sanitizeTabs", () => {
    const mockProjects: Project[] = [
      {
        id: 1,
        name: "Proj 1",
        path: "/path/1",
        avatar_path: null,
        description: null,
        notes: null,
        created_at: "",
        updated_at: "",
      },
    ];

    it("preserves the array reference on no-op data refreshes and countdown renders", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Proj 1" },
        { id: "twofa-account:one", kind: "twofa-account", accountId: "one", title: "GitHub" },
      ];
      expect(sanitizeTabs(tabs, mockProjects, {}, {})).toBe(tabs);
      const globalTabs: EditorTab[] = [{ id: "welcome", kind: "welcome", title: "Welcome" }];
      expect(sanitizeTabs(globalTabs, [], {}, {})).toBe(globalTabs);
    });

    it("retains valid tabs when data is available", () => {
      const tabs: EditorTab[] = [
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Proj 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
        { id: "command:99", kind: "command", projectId: 1, commandId: 99, title: "Deleted" },
        { id: "project-overview:2", kind: "project-overview", projectId: 2, title: "Deleted Proj" },
      ];

      const commandsByProjectId: Record<number, ProjectCommand[]> = {
        1: [
          {
            id: 10,
            project_id: 1,
            name: "Build",
            script: "npm run build",
            avatar_path: null,
            ports: "",
            section: "General",
            order_index: 0,
            runtime_mode: "internal_headless",
            run_in_external_terminal: false,
            external_terminal_kind: "default",
            interactive_terminal_kind: "powershell",
            run_count: 0,
            created_at: "",
            updated_at: "",
          },
        ],
      };

      const result = sanitizeTabs(tabs, mockProjects, commandsByProjectId, {});
      expect(result).toEqual([
        { id: "project-overview:1", kind: "project-overview", projectId: 1, title: "Proj 1" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
      ]);
    });

    it("updates open command tab titles after a rename without changing tab identity or order", () => {
      const tabs: EditorTab[] = [
        { id: "settings", kind: "settings", title: "Settings" },
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
      ];
      const command: ProjectCommand = {
        id: 10,
        project_id: 1,
        name: "Build production",
        script: "npm run build",
        avatar_path: null,
        ports: "",
        section: "General",
        order_index: 0,
        runtime_mode: "internal_headless",
        run_in_external_terminal: false,
        external_terminal_kind: "default",
        interactive_terminal_kind: "powershell",
        run_count: 0,
        created_at: "",
        updated_at: "",
      };

      const result = sanitizeTabs(tabs, mockProjects, { 1: [command] }, {});

      expect(result).toEqual([tabs[0], { ...tabs[1], title: "Build production" }]);
      expect(result[0]).toBe(tabs[0]);
      expect(tabs[1].title).toBe("Build");
      expect(sanitizeTabs(result, mockProjects, { 1: [command] }, {})[1]).toBe(result[1]);
    });

    it("does not remove command tabs if command queries are not yet loaded (undefined)", () => {
      const tabs: EditorTab[] = [
        { id: "command:10", kind: "command", projectId: 1, commandId: 10, title: "Build" },
      ];

      const commandsByProjectId: Record<number, ProjectCommand[] | undefined> = {}; // undefined for project 1

      const result = sanitizeTabs(tabs, mockProjects, commandsByProjectId, {});
      expect(result).toEqual(tabs);
    });
  });

  describe("project files explorer state persistence", () => {
    it("returns empty set when no expanded paths are saved", () => {
      expect(readSavedProjectFilesExpandedPaths(1, mockStorage)).toEqual(new Set());
    });

    it("saves and restores expanded paths for a project", () => {
      const paths = new Set(["src", "src/components", "src/lib"]);
      writeSavedProjectFilesExpandedPaths(1, paths, mockStorage);

      const restored = readSavedProjectFilesExpandedPaths(1, mockStorage);
      expect(restored).toEqual(paths);

      // Project 2 has no saved paths
      expect(readSavedProjectFilesExpandedPaths(2, mockStorage)).toEqual(new Set());
    });

    it("returns null when no selected path is saved", () => {
      expect(readSavedProjectFilesSelectedPath(1, mockStorage)).toBeNull();
    });

    it("saves and restores selected path for multiple projects", () => {
      writeSavedProjectFilesSelectedPath(1, "src/components/button.tsx", mockStorage);
      writeSavedProjectFilesSelectedPath(2, "Cargo.toml", mockStorage);

      expect(readSavedProjectFilesSelectedPath(1, mockStorage)).toBe("src/components/button.tsx");
      expect(readSavedProjectFilesSelectedPath(2, mockStorage)).toBe("Cargo.toml");

      writeSavedProjectFilesSelectedPath(1, null, mockStorage);
      expect(readSavedProjectFilesSelectedPath(1, mockStorage)).toBeNull();
      expect(readSavedProjectFilesSelectedPath(2, mockStorage)).toBe("Cargo.toml");
    });
  });

  describe("getAncestorPaths", () => {
    it("computes nested ancestor paths", () => {
      expect(getAncestorPaths("src/components/buttons/primary.tsx")).toEqual([
        "src",
        "src/components",
        "src/components/buttons",
      ]);
    });

    it("returns empty array for root or top level file", () => {
      expect(getAncestorPaths("")).toEqual([]);
      expect(getAncestorPaths("package.json")).toEqual([]);
    });

    it("returns single ancestor for immediate child file", () => {
      expect(getAncestorPaths("src/index.ts")).toEqual(["src"]);
    });
  });

  describe("resolveClosestExistingPath", () => {
    it("returns original path if it exists", async () => {
      const checkExists = async (_projectId: number, path: string) => path === "src/components/button.tsx";
      const resolved = await resolveClosestExistingPath(1, "src/components/button.tsx", checkExists);
      expect(resolved).toBe("src/components/button.tsx");
    });

    it("falls back to parent folder when selected file does not exist", async () => {
      const existing = new Set(["src", "src/components"]);
      const checkExists = async (_projectId: number, path: string) => existing.has(path);

      const resolved = await resolveClosestExistingPath(1, "src/components/deleted-file.tsx", checkExists);
      expect(resolved).toBe("src/components");
    });

    it("falls back through multiple levels of deleted folders to closest ancestor", async () => {
      const existing = new Set(["src"]);
      const checkExists = async (_projectId: number, path: string) => existing.has(path);

      const resolved = await resolveClosestExistingPath(1, "src/old-dir/nested-dir/deleted-file.tsx", checkExists);
      expect(resolved).toBe("src");
    });

    it("handles null or undefined projectId gracefully", async () => {
      const checkExists = async (_projectId: number, _path: string) => true;
      expect(await resolveClosestExistingPath(null, "src/components", checkExists)).toBe("");
      expect(await resolveClosestExistingPath(undefined, "src/components", checkExists)).toBe("");
    });
  });

  describe("null-safety edge cases", () => {
    it("handles null or undefined projectId in project files persistence", () => {
      expect(readSavedProjectFilesExpandedPaths(null, mockStorage)).toEqual(new Set());
      expect(readSavedProjectFilesExpandedPaths(undefined, mockStorage)).toEqual(new Set());
      expect(readSavedProjectFilesSelectedPath(null, mockStorage)).toBeNull();
      expect(readSavedProjectFilesSelectedPath(undefined, mockStorage)).toBeNull();

      // Writing with null/undefined should not throw
      expect(() => writeSavedProjectFilesExpandedPaths(null, new Set(["src"]), mockStorage)).not.toThrow();
      expect(() => writeSavedProjectFilesSelectedPath(null, "src", mockStorage)).not.toThrow();
    });

    it("handles corrupted or null elements in sanitizeTabs", () => {
      const corruptedTabs: any[] = [
        null,
        undefined,
        { id: "settings", kind: "settings", title: "Settings" },
        { id: "corrupted", kind: "command", projectId: 1, commandId: 10 },
      ];
      const corruptedProjects: any[] = [null, undefined, { id: 1, name: "Proj 1" }];

      const result = sanitizeTabs(corruptedTabs, corruptedProjects, { 1: undefined }, {});
      expect(result).toHaveLength(2);
      expect(result[0].kind).toBe("settings");
      expect(result[1].id).toBe("corrupted");
    });

    it("sanitizes twofa-account tabs to neutral 2FA title in read, write and migration", () => {
      const tabsWithSecrets: any[] = [
        { id: "twofa-account:acc1", kind: "twofa-account", title: "GitHub: user@example.com", accountId: "acc1" },
        { id: "welcome", kind: "welcome", title: "Welcome" },
      ];

      writeSavedTabs(tabsWithSecrets as any, mockStorage);
      const read = readSavedTabs(mockStorage);
      expect(read?.[0].title).toBe("2FA");

      // Verify stored json in storage has title "2FA"
      const rawStored = JSON.parse(mockStorage.getItem("vscodeEditorTabs")!);
      expect(rawStored[0].title).toBe("2FA");

      // Test migration from pre-existing leaked titles and legacy flow keys
      mockStorage.setItem(
        "vscodeEditorTabs",
        JSON.stringify([
          { id: "twofa-account:acc2", kind: "twofa-account", title: "AWS: admin", accountId: "acc2" },
          { id: "flow:1", kind: "flow", title: "My Flow" },
        ]),
      );
      mockStorage.setItem("projects-runner:flows", "some-legacy-flows");
      mockStorage.setItem("flow-editor-state", "some-legacy-state");

      migrateLocalStorageTwofaState(mockStorage);

      const migratedRaw = JSON.parse(mockStorage.getItem("vscodeEditorTabs")!);
      expect(migratedRaw).toHaveLength(1);
      expect(migratedRaw[0].title).toBe("2FA");
      expect(mockStorage.getItem("projects-runner:flows")).toBeNull();
      expect(mockStorage.getItem("flow-editor-state")).toBeNull();
    });
  });
});
