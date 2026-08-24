import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSuggestedIconOptions,
  deviconIconId,
  deviconIconValue,
  getLucideIconOption,
  getRecentIconIds,
  saveRecentIconId,
  SUGGESTED_ICONS_COUNT,
} from "./entity-avatar";

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  writable: true,
});

describe("entity-avatar icon utilities", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("getLucideIconOption", () => {
    it("resolves built-in preset icon aliases", () => {
      const terminalOption = getLucideIconOption("terminal");
      expect(terminalOption).toBeDefined();
      expect(terminalOption?.id).toBe("terminal");
      expect(terminalOption?.label).toBe("Terminal");
    });

    it("resolves Lucide canonical icon names case-insensitively", () => {
      const zapOption = getLucideIconOption("Zap");
      expect(zapOption).toBeDefined();

      const lowerZap = getLucideIconOption("zap");
      expect(lowerZap).toBeDefined();
      expect(lowerZap?.id).toBe(zapOption?.id);
    });

    it("resolves icons with lucide: prefix", () => {
      const rocketOption = getLucideIconOption("lucide:rocket");
      expect(rocketOption).toBeDefined();
      expect(rocketOption?.id).toBe("rocket");
    });

    it("returns undefined for null, empty or unknown icons", () => {
      expect(getLucideIconOption(null)).toBeUndefined();
      expect(getLucideIconOption("")).toBeUndefined();
      expect(getLucideIconOption("definitely-unknown-icon-xyz-123")).toBeUndefined();
    });
  });

  describe("saveRecentIconId and getRecentIconIds", () => {
    it("returns empty array when nothing is stored", () => {
      expect(getRecentIconIds()).toEqual([]);
    });

    it("saves and retrieves recent icons in MRU order (newest first)", () => {
      saveRecentIconId("terminal");
      saveRecentIconId("folder");
      saveRecentIconId("code");

      const recent = getRecentIconIds();
      expect(recent).toEqual(["code", "folder", "terminal"]);
    });

    it("moves existing icon to top without duplicate", () => {
      saveRecentIconId("terminal");
      saveRecentIconId("folder");
      saveRecentIconId("terminal");

      const recent = getRecentIconIds();
      expect(recent).toEqual(["terminal", "folder"]);
    });

    it("strips lucide: prefix when saving", () => {
      saveRecentIconId("lucide:database");
      expect(getRecentIconIds()).toEqual(["database"]);
    });

    it("limits saved recent icons to SUGGESTED_ICONS_COUNT (20)", () => {
      for (let i = 0; i < 25; i++) {
        saveRecentIconId(`icon-${i}`);
      }

      const recent = getRecentIconIds();
      expect(recent.length).toBe(SUGGESTED_ICONS_COUNT);
      expect(recent[0]).toBe("icon-24");
    });
  });

  describe("buildSuggestedIconOptions", () => {
    it("always returns exactly 20 icons when no recent icons exist", () => {
      const suggested = buildSuggestedIconOptions([], 20);
      expect(suggested.length).toBe(20);

      // Verify all IDs are unique
      const ids = suggested.map((item) => item.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);
    });

    it("places recently used icons at the top with newest first", () => {
      const recentIds = ["Rocket", "Flame", "Zap"];
      const suggested = buildSuggestedIconOptions(recentIds, 20);

      expect(suggested.length).toBe(20);

      // First items should correspond to the valid recent icons
      expect(suggested[0]?.id.toLowerCase()).toBe("rocket");
      expect(suggested[1]?.id.toLowerCase()).toBe("flame");
      expect(suggested[2]?.id.toLowerCase()).toBe("zap");
    });

    it("deduplicates recent icons against default icons without losing count", () => {
      // "terminal" and "folder" are default iconOptions
      const recentIds = ["folder", "terminal"];
      const suggested = buildSuggestedIconOptions(recentIds, 20);

      expect(suggested.length).toBe(20);
      expect(suggested[0]?.id).toBe("folder");
      expect(suggested[1]?.id).toBe("terminal");

      // Verify no duplicates
      const ids = suggested.map((item) => item.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);
    });

    it("skips invalid recent icons and still supplies 20 icons", () => {
      const recentIds = ["invalid-icon-1", "terminal", "invalid-icon-2"];
      const suggested = buildSuggestedIconOptions(recentIds, 20);

      expect(suggested.length).toBe(20);
      expect(suggested[0]?.id).toBe("terminal");
    });
  });

  describe("deviconIconValue and deviconIconId", () => {
    it("encodes devicon prefix properly", () => {
      expect(deviconIconValue("react")).toBe("devicon:react");
      expect(deviconIconValue("tauri")).toBe("devicon:tauri");
    });

    it("extracts devicon id from prefixed path", () => {
      expect(deviconIconId("devicon:react")).toBe("react");
      expect(deviconIconId("devicon:rust")).toBe("rust");
      expect(deviconIconId("lucide:terminal")).toBeNull();
      expect(deviconIconId("/path/to/icon.png")).toBeNull();
      expect(deviconIconId(null)).toBeNull();
      expect(deviconIconId(undefined)).toBeNull();
    });
  });
});
