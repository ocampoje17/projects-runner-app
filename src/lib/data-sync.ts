import { invoke } from "@tauri-apps/api/core";
import type { SyncLink, SyncPreview, SyncResult, SyncScopes, SyncStatus } from "../types/generated/sync";

export type * from "../types/generated/sync";
export const DEFAULT_SYNC_SCOPES: SyncScopes = { projects: true, commands: true, notes: true, avatars: true, preferences: true };
export const SYNC_GROUPS = [
  ["projects", "Projects"], ["commands", "Commands"], ["notes", "Notes"],
  ["avatars", "Avatars"], ["preferences", "App preferences"],
] as const;
export const SYNC_PREFERENCE_KEYS = [
  "theme", "accent", "dateFormat", "terminalFontSize", "terminalFontFamily", "autoClearLogs",
  "showLogsTimestamp", "showStreamName", "explorerAllowMultipleOpen", "restoreOpenTabs",
] as const;
const defaults: Record<typeof SYNC_PREFERENCE_KEYS[number], string> = {
  theme: "dark", accent: "mono", dateFormat: "dd/mm/yyyy", terminalFontSize: "13px",
  terminalFontFamily: "Consolas", autoClearLogs: "true", showLogsTimestamp: "false",
  showStreamName: "true", explorerAllowMultipleOpen: "false", restoreOpenTabs: "true",
};
export function readSyncPreferences() {
  return Object.fromEntries(SYNC_PREFERENCE_KEYS.map(key => [key, localStorage.getItem(key) ?? defaults[key]]));
}
export function applySyncPreferences(preferences: Record<string, string>) {
  for (const key of SYNC_PREFERENCE_KEYS) {
    if (typeof preferences[key] === "string") localStorage.setItem(key, preferences[key]);
  }
  window.dispatchEvent(new Event("projects-runner:preferences-synced"));
}
export function changeSyncScope(scopes: SyncScopes, key: keyof SyncScopes, checked: boolean): SyncScopes {
  const next = { ...scopes, [key]: checked };
  if (key === "projects" && !checked) return { ...next, commands: false, notes: false, avatars: false };
  if (checked && (key === "commands" || key === "notes" || key === "avatars")) next.projects = true;
  return next;
}
export const syncApi = {
  status: () => invoke<SyncStatus>("sync_get_status"),
  configure: (folder: string | null, scopes: SyncScopes) => invoke<SyncStatus>("sync_configure", { folder, scopes }),
  prepare: (links: SyncLink[] | null = null, sessionId: string | null = null) =>
    invoke<SyncPreview>("sync_prepare", { preferences: readSyncPreferences(), links, sessionId }),
  commit: (sessionId: string, choices: Record<string, string>, preferences = readSyncPreferences()) =>
    invoke<SyncResult>("sync_commit", { sessionId, choices, preferences }),
  cancel: (sessionId: string) => invoke<void>("sync_cancel", { sessionId }),
  acknowledge: (preferences: Record<string, string>) => invoke<void>("sync_ack_preferences", { preferences }),
};
