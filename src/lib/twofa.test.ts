import { describe, expect, it } from "vitest";
import {
  type LockTimeSetting,
  type HideTokenSetting,
  type ClearClipboardSetting,
  type SortOrderSetting,
  type CommitImportItemSelection,
} from "./api";
import {
  migrateLocalStorageTwofaState,
  writeSavedTabs,
  type EditorTab,
} from "./sidebar-state";

describe("2FA Type Definitions and Constraints", () => {
  it("enforces valid LockTimeSetting union values", () => {
    const validLockTimes: LockTimeSetting[] = [
      "Never",
      "ThirtySeconds",
      "OneMinute",
      "FiveMinutes",
      "TenMinutes",
      "ThirtyMinutes",
      "OneHour",
    ];
    expect(validLockTimes).toHaveLength(7);
  });

  it("enforces valid HideTokenSetting union values", () => {
    const validHideTokens: HideTokenSetting[] = ["Never", "ShowAfterClick", "Always"];
    expect(validHideTokens).toHaveLength(3);
  });

  it("enforces valid ClearClipboardSetting union values", () => {
    const validClearClipboard: ClearClipboardSetting[] = [
      "Disabled",
      "TenSeconds",
      "TwentySeconds",
      "ThirtySeconds",
      "OneMinute",
    ];
    expect(validClearClipboard).toHaveLength(5);
  });

  it("enforces valid SortOrderSetting union values", () => {
    const validSortOrders: SortOrderSetting[] = [
      "ISSUER_ASC",
      "ISSUER_DESC",
      "CREATED_ASC",
      "CREATED_DESC",
    ];
    expect(validSortOrders).toHaveLength(4);
  });

  it("restricts import duplicate handling to link/skip actions (no overwrite)", () => {
    const item: CommitImportItemSelection = {
      temp_id: "preview-1",
      selected: true,
      action: "link",
      issuer: "GitHub",
      account: "octocat",
      secret: null,
      algorithm: null,
      digits: null,
      period: null,
      project_ids: [1, 2],
    };
    expect(item.action).toBe("link");
    expect(item).not.toHaveProperty("overwrite");
  });
});

describe("2FA Storage and Tab Privacy", () => {
  it("never persists plaintext issuer or account names in localStorage", () => {
    const testStorage = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (k) => testStorage.get(k) ?? null,
      setItem: (k, v) => testStorage.set(k, String(v)),
      removeItem: (k) => testStorage.delete(k),
      clear: () => testStorage.clear(),
      key: (i) => Array.from(testStorage.keys())[i] ?? null,
      length: testStorage.size,
    };

    const tabsWithSensitiveTitles: EditorTab[] = [
      {
        id: "twofa-account:acc-123",
        kind: "twofa-account",
        title: "Google: user@gmail.com",
        accountId: "acc-123",
      },
      {
        id: "project-overview:1",
        kind: "project-overview",
        title: "My Project",
        projectId: 1,
      },
    ];

    writeSavedTabs(tabsWithSensitiveTitles, mockStorage);

    const savedRaw = testStorage.get("vscodeEditorTabs");
    expect(savedRaw).toBeDefined();
    expect(savedRaw).not.toContain("Google: user@gmail.com");

    const parsedTabs = JSON.parse(savedRaw!);
    const twofaTab = parsedTabs.find((t: EditorTab) => t.id === "twofa-account:acc-123");
    expect(twofaTab).toBeDefined();
    expect(twofaTab.title).toBe("2FA");
  });

  it("migrates existing tabs and purges legacy flow tabs", () => {
    const testStorage = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (k) => testStorage.get(k) ?? null,
      setItem: (k, v) => testStorage.set(k, String(v)),
      removeItem: (k) => testStorage.delete(k),
      clear: () => testStorage.clear(),
      key: (i) => Array.from(testStorage.keys())[i] ?? null,
      length: testStorage.size,
    };

    const dirtyTabs = [
      { id: "flow:legacy-1", kind: "flow", title: "Old Flow" },
      { id: "twofa-account:acc-999", kind: "twofa-account", title: "GitHub: octocat" },
      { id: "flows-overview:1", kind: "flows-overview", title: "Flows" },
    ];
    testStorage.set("vscodeEditorTabs", JSON.stringify(dirtyTabs));
    testStorage.set("vscodeFlowCanvasState", "dirty-canvas-data");

    migrateLocalStorageTwofaState(mockStorage);

    expect(mockStorage.getItem("vscodeFlowCanvasState")).toBeNull();
    expect(testStorage.get("vscodeFlowCanvasState")).toBeUndefined();

    const cleanedRaw = testStorage.get("vscodeEditorTabs");
    const cleanedTabs = JSON.parse(cleanedRaw!);
    expect(cleanedTabs).toHaveLength(1);
    expect(cleanedTabs[0].id).toBe("twofa-account:acc-999");
    expect(cleanedTabs[0].title).toBe("2FA");
  });
});

describe("TwofaApiError and parseTwofaSecurityError", () => {
  it("creates and parses TwofaApiError instance correctly", async () => {
    const { TwofaApiError, parseTwofaSecurityError } = await import("./api");
    const err = new TwofaApiError("PIN_BLOCKED", "Too many attempts", "Details here");
    expect(err.code).toBe("PIN_BLOCKED");
    expect(err.message).toBe("Too many attempts");
    expect(err.details).toBe("Details here");

    const parsed = parseTwofaSecurityError(err);
    expect(parsed.code).toBe("PIN_BLOCKED");
    expect(parsed.message).toBe("Too many attempts");
    expect(parsed.details).toBe("Details here");
  });

  it("parses structured error object from backend IPC", async () => {
    const { parseTwofaSecurityError } = await import("./api");
    const obj = {
      code: "RECOVERY_REQUIRED",
      message: "Interrupted transition detected",
      details: null,
    };
    const parsed = parseTwofaSecurityError(obj);
    expect(parsed.code).toBe("RECOVERY_REQUIRED");
    expect(parsed.message).toBe("Interrupted transition detected");
    expect(parsed.details).toBeNull();
  });

  it("parses formatted string with code and message", async () => {
    const { parseTwofaSecurityError } = await import("./api");
    const parsed = parseTwofaSecurityError("SESSION_EXPIRED: Invalid session token");
    expect(parsed.code).toBe("SESSION_EXPIRED");
    expect(parsed.message).toBe("Invalid session token");
  });

  it("gracefully falls back for unknown or generic errors", async () => {
    const { parseTwofaSecurityError } = await import("./api");
    const parsed = parseTwofaSecurityError(new Error("Network failed"));
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.message).toBe("Network failed");
  });
});
