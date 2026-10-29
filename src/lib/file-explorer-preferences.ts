import type { Layout } from "react-resizable-panels";
import type { QuickAccessEntry } from "../components/quick-access-dialog";

export const FILE_EXPLORER_PREFERENCES_KEY = "vscodeFileExplorerPreferences";
export type FileExplorerPreferences = {
  quickAccess: QuickAccessEntry[];
  detailsCollapsed: boolean;
  quickAccessCollapsed: boolean;
  twofaCollapsed: boolean;
  detailsExpandedSize: number;
  quickAccessExpandedSize: number;
  twofaExpandedSize: number;
  showSizeBars: boolean;
  panelLayout: Layout;
};
export const DEFAULT_FILE_EXPLORER_PREFERENCES: FileExplorerPreferences = {
  quickAccess: [], detailsCollapsed: false, quickAccessCollapsed: false, twofaCollapsed: false,
  detailsExpandedSize: 20, quickAccessExpandedSize: 20, twofaExpandedSize: 20, showSizeBars: true,
  panelLayout: { "file-tree": 40, "file-details": 20, "quick-access": 20, "project-twofa": 20 },
};

function positive(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function fitBottomPanels(sizes: number[], minimums: number[]): Layout {
  const fitted = sizes.map((size, index) => Math.max(size, minimums[index]));
  const total = fitted.reduce((sum, size) => sum + size, 0);
  if (total > 65) {
    const minimumTotal = minimums.reduce((sum, size) => sum + size, 0);
    const ratio = Math.max(0, (65 - minimumTotal) / (total - minimumTotal || 1));
    fitted.forEach((size, index) => { fitted[index] = minimums[index] + (size - minimums[index]) * ratio; });
  }
  return {
    "file-tree": 100 - fitted.reduce((sum, size) => sum + size, 0),
    "file-details": fitted[0], "quick-access": fitted[1], "project-twofa": fitted[2],
  };
}

export function getFileExplorerLayout(preferences: FileExplorerPreferences, groupHeight: number): Layout {
  const collapsed = Math.min(30 / Math.max(1, groupHeight) * 100, 65 / 3);
  const minimums = [preferences.detailsCollapsed ? collapsed : 18, preferences.quickAccessCollapsed ? collapsed : 14, preferences.twofaCollapsed ? collapsed : 14];
  return fitBottomPanels([
    preferences.detailsCollapsed ? collapsed : preferences.detailsExpandedSize,
    preferences.quickAccessCollapsed ? collapsed : preferences.quickAccessExpandedSize,
    preferences.twofaCollapsed ? collapsed : preferences.twofaExpandedSize,
  ], minimums);
}

export function readFileExplorerPreferences(storage?: Pick<Storage, "getItem">): FileExplorerPreferences {
  try {
    const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const parsed: unknown = JSON.parse(store?.getItem(FILE_EXPLORER_PREFERENCES_KEY) ?? "{}");
    const saved = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    const layout = saved.panelLayout && typeof saved.panelLayout === "object" ? saved.panelLayout as Record<string, unknown> : {};
    const isLegacy = layout["project-twofa"] === undefined && layout["file-tree"] !== undefined;
    const scale = isLegacy ? 0.8 : 1;
    const panelLayout = fitBottomPanels([
      positive(layout["file-details"], 20 / scale) * scale,
      positive(layout["quick-access"], 20 / scale) * scale,
      positive(layout["project-twofa"], 20),
    ], [18, 14, 14]);
    return {
      quickAccess: Array.isArray(saved.quickAccess) ? saved.quickAccess.filter((item: unknown): item is QuickAccessEntry => Boolean(item) && typeof (item as QuickAccessEntry).projectId === "number" && typeof (item as QuickAccessEntry).relativePath === "string" && typeof (item as QuickAccessEntry).name === "string" && typeof (item as QuickAccessEntry).isDirectory === "boolean") : [],
      detailsCollapsed: Boolean(saved.detailsCollapsed), quickAccessCollapsed: Boolean(saved.quickAccessCollapsed), twofaCollapsed: Boolean(saved.twofaCollapsed),
      detailsExpandedSize: Math.max(18, positive(saved.detailsExpandedSize, panelLayout["file-details"]) * (isLegacy && saved.detailsExpandedSize !== undefined ? scale : 1)),
      quickAccessExpandedSize: Math.max(14, positive(saved.quickAccessExpandedSize, panelLayout["quick-access"]) * (isLegacy && saved.quickAccessExpandedSize !== undefined ? scale : 1)),
      twofaExpandedSize: Math.max(14, positive(saved.twofaExpandedSize, 20)),
      showSizeBars: typeof saved.showSizeBars === "boolean" ? saved.showSizeBars : true,
      panelLayout,
    };
  } catch {
    return { ...DEFAULT_FILE_EXPLORER_PREFERENCES };
  }
}
