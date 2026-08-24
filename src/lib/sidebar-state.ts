import type { Project, ProjectCommand, ProjectFlow } from "./api";
import type { ProjectNote } from "../components/project-detail-types";
import type { SettingsSectionId } from "../components/SettingsPage";

export type SidebarView = "explorer" | "flows" | "notes" | "terminal" | "settings";

export type EditorTab =
  | { id: string; kind: "welcome"; title: string }
  | { id: string; kind: "project-overview"; title: string; projectId: number }
  | { id: string; kind: "commands-overview"; title: string; projectId: number }
  | { id: string; kind: "notes-overview"; title: string; projectId: number }
  | { id: string; kind: "flows-overview"; title: string; projectId: number }
  | { id: string; kind: "command"; title: string; projectId: number; commandId: number }
  | { id: string; kind: "note"; title: string; projectId: number; noteId: string }
  | { id: string; kind: "flow"; title: string; projectId: number; flowId: number }
  | { id: string; kind: "file-view"; title: string; projectId: number; relativePath: string }
  | { id: string; kind: "settings"; title: string };

export const SIDEBAR_STORAGE_KEYS = {
  SELECTED_PROJECT_ID: "selectedProjectId",
  SIDEBAR_VIEW: "vscodeSidebarView",
  SIDEBAR_LAYOUT: "vscodeSidebarLayout",
  FILE_EXPLORER_SIDEBAR: "vscodeFileExplorerSidebar",
  FILE_EXPLORER_PREFERENCES: "vscodeFileExplorerPreferences",
  TREE_EXPANDED: "vscodeTreeExpandedState",
  EXPANDED_PROJECTS: "vscodeExpandedProjectIds",
  EDITOR_TABS: "vscodeEditorTabs",
  ACTIVE_TAB: "vscodeActiveTabId",
  PINNED_TABS: "vscodePinnedTabIds",
  SETTINGS_SECTION: "vscodeSettingsSection",
  PROJECT_FILES_EXPANDED: "vscodeProjectFilesExpandedPaths",
  PROJECT_FILES_SELECTED: "vscodeProjectFilesSelectedPath",
} as const;

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
}

export function readSavedSelectedProjectId(storage?: Storage): number | null {
  try {
    const store = getStorage(storage);
    if (!store) return null;
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.SELECTED_PROJECT_ID);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSavedSelectedProjectId(projectId: number | null, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    if (projectId !== null) {
      store.setItem(SIDEBAR_STORAGE_KEYS.SELECTED_PROJECT_ID, String(projectId));
    }
  } catch {}
}

export function readSavedTabs(storage?: Storage, restoreAll = true): EditorTab[] | null {
  try {
    const store = getStorage(storage);
    if (!store) return null;
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.EDITOR_TABS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const validTabs = parsed.filter(
        (tab): tab is EditorTab =>
          Boolean(tab) &&
          typeof tab === "object" &&
          typeof tab.id === "string" &&
          typeof tab.kind === "string" &&
          typeof tab.title === "string",
      );
      if (validTabs.length === 0) return null;
      if (restoreAll) {
        return validTabs;
      }
      const pinned = readSavedPinnedTabIds(storage);
      const pinnedOnly = validTabs.filter((tab) => pinned.has(tab.id));
      return pinnedOnly.length > 0 ? pinnedOnly : null;
    }
  } catch {}
  return null;
}

export function writeSavedTabs(tabs: EditorTab[], storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.EDITOR_TABS, JSON.stringify(tabs));
  } catch {}
}

export function readSavedActiveTabId(storage?: Storage, validTabIds?: Set<string>): string | null {
  try {
    const store = getStorage(storage);
    if (!store) return null;
    const saved = store.getItem(SIDEBAR_STORAGE_KEYS.ACTIVE_TAB);
    if (saved && typeof saved === "string") {
      if (validTabIds && !validTabIds.has(saved)) {
        return null;
      }
      return saved;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSavedActiveTabId(activeTabId: string, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.ACTIVE_TAB, activeTabId);
  } catch {}
}

export function readSavedPinnedTabIds(storage?: Storage): Set<string> {
  try {
    const store = getStorage(storage);
    if (!store) return new Set();
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.PINNED_TABS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === "string"));
    }
  } catch {}
  return new Set();
}

export function writeSavedPinnedTabIds(pinnedTabIds: Set<string>, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.PINNED_TABS, JSON.stringify([...pinnedTabIds]));
  } catch {}
}

export function readSavedSettingsSection(storage?: Storage): SettingsSectionId {
  try {
    const store = getStorage(storage);
    if (!store) return "appearance";
    const saved = store.getItem(SIDEBAR_STORAGE_KEYS.SETTINGS_SECTION);
    return saved === "terminal" || saved === "system" ? saved : "appearance";
  } catch {
    return "appearance";
  }
}

export function writeSavedSettingsSection(section: SettingsSectionId, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.SETTINGS_SECTION, section);
  } catch {}
}

export function readExpandedProjectIds(storage?: Storage): Set<number> {
  try {
    const store = getStorage(storage);
    if (!store) return new Set();
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.EXPANDED_PROJECTS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is number => typeof id === "number"));
    }
  } catch {}
  return new Set();
}

export function writeExpandedProjectIds(expandedProjectIds: Set<number>, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.EXPANDED_PROJECTS, JSON.stringify([...expandedProjectIds]));
  } catch {}
}

export function readTreeExpandedState(storage?: Storage): Record<string, boolean> {
  try {
    const store = getStorage(storage);
    if (!store) return {};
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.TREE_EXPANDED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, boolean>;
      }
    }
  } catch {}
  return {};
}

export function writeTreeExpandedState(state: Record<string, boolean>, storage?: Storage): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(SIDEBAR_STORAGE_KEYS.TREE_EXPANDED, JSON.stringify(state));
  } catch {}
}

export function toggleProjectExpansion(
  current: Set<number>,
  projectId: number,
  allowMultiple: boolean,
): Set<number> {
  if (allowMultiple) {
    const next = new Set(current);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    return next;
  }

  // Single-item (accordion) mode: clicking expanded collapses it, clicking collapsed expands only that one
  if (current.has(projectId)) {
    return new Set();
  }
  return new Set([projectId]);
}

export function sanitizeTabs(
  tabs: EditorTab[],
  projects: Project[],
  commandsByProjectId: Record<number, ProjectCommand[] | undefined>,
  flowsByProjectId: Record<number, ProjectFlow[] | undefined>,
  notesByProjectId: Record<number, ProjectNote[] | undefined>,
): EditorTab[] {
  if (!Array.isArray(tabs)) return [];
  if (!Array.isArray(projects) || projects.length === 0) {
    return tabs.filter((tab) => Boolean(tab) && (tab.kind === "settings" || tab.kind === "welcome"));
  }

  return tabs.filter((tab) => {
    if (!tab) return false;
    if (tab.kind === "welcome" || tab.kind === "settings") {
      return true;
    }

    const project = projects.find((p) => Boolean(p) && p.id === tab.projectId);
    if (!project) {
      return false;
    }

    if (tab.kind === "command") {
      const cmds = commandsByProjectId[tab.projectId];
      if (cmds !== undefined) {
        return Array.isArray(cmds) && cmds.some((cmd) => Boolean(cmd) && cmd.id === tab.commandId);
      }
      return true;
    }

    if (tab.kind === "note") {
      const notes = notesByProjectId[tab.projectId];
      if (notes !== undefined) {
        return Array.isArray(notes) && notes.some((note) => Boolean(note) && note.id === tab.noteId);
      }
      return true;
    }

    if (tab.kind === "flow") {
      const flows = flowsByProjectId[tab.projectId];
      if (flows !== undefined) {
        return Array.isArray(flows) && flows.some((flow) => Boolean(flow) && flow.id === tab.flowId);
      }
      return true;
    }

    return true;
  });
}

export function readSavedProjectFilesExpandedPaths(projectId: number | null | undefined, storage?: Storage): Set<string> {
  if (!projectId || typeof projectId !== "number") return new Set();
  try {
    const store = getStorage(storage);
    if (!store) return new Set();
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_EXPANDED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed[String(projectId)])) {
      return new Set((parsed[String(projectId)] as unknown[]).filter((p): p is string => typeof p === "string"));
    }
  } catch {}
  return new Set();
}

export function writeSavedProjectFilesExpandedPaths(projectId: number | null | undefined, paths: Set<string>, storage?: Storage): void {
  if (!projectId || typeof projectId !== "number") return;
  try {
    const store = getStorage(storage);
    if (!store) return;
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_EXPANDED);
    const map = raw ? JSON.parse(raw) : {};
    map[String(projectId)] = Array.from(paths);
    store.setItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_EXPANDED, JSON.stringify(map));
  } catch {}
}

export function readSavedProjectFilesSelectedPath(projectId: number | null | undefined, storage?: Storage): string | null {
  if (!projectId || typeof projectId !== "number") return null;
  try {
    const store = getStorage(storage);
    if (!store) return null;
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_SELECTED);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed[String(projectId)] === "string") {
      return parsed[String(projectId)];
    }
  } catch {}
  return null;
}

export function writeSavedProjectFilesSelectedPath(projectId: number | null | undefined, path: string | null, storage?: Storage): void {
  if (!projectId || typeof projectId !== "number") return;
  try {
    const store = getStorage(storage);
    if (!store) return;
    const raw = store.getItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_SELECTED);
    const map = raw ? JSON.parse(raw) : {};
    if (path !== null) {
      map[String(projectId)] = path;
    } else {
      delete map[String(projectId)];
    }
    store.setItem(SIDEBAR_STORAGE_KEYS.PROJECT_FILES_SELECTED, JSON.stringify(map));
  } catch {}
}

export function getAncestorPaths(relativePath: string): string[] {
  if (!relativePath) return [];
  const parts = relativePath.split("/").filter(Boolean);
  const ancestors: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length - 1; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    ancestors.push(current);
  }
  return ancestors;
}

export async function resolveClosestExistingPath(
  projectId: number | null | undefined,
  targetPath: string,
  checkExists: (projectId: number, relativePath: string) => Promise<boolean>,
): Promise<string> {
  if (!projectId || typeof projectId !== "number") return "";
  let current = targetPath.trim().replace(/^\/+|\/+$/g, "");
  while (current) {
    const exists = await checkExists(projectId, current).catch(() => false);
    if (exists) return current;
    const lastSlash = current.lastIndexOf("/");
    if (lastSlash === -1) {
      current = "";
    } else {
      current = current.slice(0, lastSlash);
    }
  }
  return "";
}
