// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TwofaAccountSummary, TwofaCodeItem } from "@/lib/api";
import type { TwofaContextValue } from "./TwofaProvider";
import { FilesTwofaPanel } from "./files-twofa-panel";
import { sortTwofaAccounts } from "./twofa-utils";

const mocks = vi.hoisted(() => ({ desktop: true, copy: vi.fn(), clipboard: vi.fn(), reveal: vi.fn() }));
let context: TwofaContextValue;
vi.mock("./TwofaProvider", () => ({ useTwofa: () => context }));
vi.mock("@/lib/api", () => ({ isDesktopRuntime: () => mocks.desktop }));
vi.mock("./twofa-utils", async (original) => ({ ...await original<object>(), copyToClipboardWithAutoClear: mocks.clipboard }));
vi.mock("./twofa-lock-dialog", () => ({ TwofaLockDialog: ({ mode }: { mode: string }) => <div role="dialog">{mode}</div> }));

const account = (id: string, issuer: string, projectIds: number[]): TwofaAccountSummary => ({ id, issuer, account: `${id}@example.test`, project_ids: projectIds, algorithm: "SHA1", digits: 6, period: 30, notes: "", icon: null, is_valid: true, validation_error: null, created_at: id === "a" ? "2026-01-01" : "2026-02-01", updated_at: "" });
const code = (id: string, text = "012345"): TwofaCodeItem => ({ account_id: id, code: text, period: 30, valid_until: 100, remaining_seconds: 15, is_valid: true, error: null });

beforeEach(() => {
  mocks.desktop = true;
  mocks.copy.mockReset().mockResolvedValue({ success: true, remaining_seconds: 15 });
  mocks.clipboard.mockReset().mockResolvedValue(undefined);
  mocks.reveal.mockReset();
  context = {
    status: { has_vault: true, hide_token_setting: "Never", clear_clipboard_setting: "TenSeconds", sort_order_setting: "ISSUER_ASC" },
    isUnlocked: true, sessionId: "test-session", isLoading: false, isCodesError: false,
    accounts: [account("a", "GitHub", [1, 2]), account("b", "Google", [2]), account("c", "AWS", [1])],
    codesByAccountId: { a: code("a"), b: code("b"), c: code("c", "00112233") },
    revealedAccountIds: new Set(), toggleReveal: mocks.reveal, copyCode: mocks.copy,
    refreshCodes: vi.fn(),
  } as unknown as TwofaContextValue;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Files project 2FA", () => {
  it("filters by the Files project, including shared accounts, and follows the vault sort order", () => {
    const { rerender } = render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy 2FA code for AWS (c@example.test)", "Copy 2FA code for GitHub (a@example.test)",
    ]);
    expect(screen.getByText("0011 2233")).toBeTruthy();
    rerender(<FilesTwofaPanel projectId={2} onError={vi.fn()} />);
    expect(screen.queryByText("AWS")).toBeNull();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
  });

  it("copies with one click, reveals ShowAfterClick, and clears feedback after two seconds", async () => {
    vi.useFakeTimers();
    context.status!.hide_token_setting = "ShowAfterClick";
    render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    expect(screen.queryByText("012 345")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy 2FA code for GitHub (a@example.test)" })); });
    expect(mocks.copy).toHaveBeenCalledWith("a");
    expect(mocks.reveal).toHaveBeenCalledWith("a");
    expect(screen.getByLabelText("Copied")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByLabelText("Copied")).toBeNull();
  });

  it("keeps Always-hidden codes masked while still allowing copy", async () => {
    context.status!.hide_token_setting = "Always";
    render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy 2FA code for GitHub/ })); });
    expect(mocks.copy).toHaveBeenCalledWith("a");
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(screen.queryByText("012 345")).toBeNull();
  });

  it("uses clipboard auto-clear settings in browser preview", async () => {
    mocks.desktop = false;
    render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy 2FA code for GitHub/ })); });
    expect(mocks.clipboard).toHaveBeenCalledWith("012345", 10);
  });

  it("reports failed copies and never shows success feedback for them", async () => {
    const onError = vi.fn();
    mocks.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    render(<FilesTwofaPanel projectId={1} onError={onError} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy 2FA code for GitHub/ })); });
    expect(onError).toHaveBeenCalledWith("Clipboard unavailable");
    expect(screen.queryByLabelText("Copied")).toBeNull();
  });

  it("updates OTP and countdown without local polling and disables expired codes", () => {
    const { rerender } = render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    context.codesByAccountId.a = { ...code("a", "987654"), remaining_seconds: 1 };
    rerender(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    expect(screen.getByText("987 654")).toBeTruthy();
    expect(screen.getByText("1s")).toBeTruthy();
    context.codesByAccountId.a.remaining_seconds = 0;
    rerender(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Copy 2FA code for GitHub/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("987 654")).toBeNull();
  });

  it("immediately hides account details and codes on lock and uses the existing unlock dialog", () => {
    const { rerender } = render(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    context.isUnlocked = false;
    context.sessionId = null;
    rerender(<FilesTwofaPanel projectId={1} onError={vi.fn()} />);
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.queryByText("012 345")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(screen.getByRole("dialog").textContent).toBe("unlock");
  });

  it("supports setup and an empty project", () => {
    const { rerender } = render(<FilesTwofaPanel projectId={99} onError={vi.fn()} />);
    expect(screen.getByText("No linked 2FA accounts.")).toBeTruthy();
    context.isUnlocked = false;
    context.status!.has_vault = false;
    rerender(<FilesTwofaPanel projectId={99} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up vault" }));
    expect(screen.getByRole("dialog").textContent).toBe("setup");
  });

  it("ignores a pending copy result after the vault locks", async () => {
    let finishCopy!: (value: { success: boolean; remaining_seconds: number }) => void;
    mocks.copy.mockImplementationOnce(() => new Promise((resolve) => { finishCopy = resolve; }));
    context.status!.hide_token_setting = "ShowAfterClick";
    const onError = vi.fn();
    const { rerender } = render(<FilesTwofaPanel projectId={1} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy 2FA code for GitHub/ }));
    context.isUnlocked = false;
    context.sessionId = null;
    rerender(<FilesTwofaPanel projectId={1} onError={onError} />);
    await act(async () => { finishCopy({ success: true, remaining_seconds: 15 }); });
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Copied")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("sorts consistently with the overview without mutating provider accounts", () => {
    const original = [...context.accounts];
    expect(sortTwofaAccounts(original, "CREATED_ASC")[0].id).toBe("a");
    expect(sortTwofaAccounts(original, "CREATED_DESC")[0].id).toBe("b");
    expect(sortTwofaAccounts(original, "ISSUER_DESC")[0].issuer).toBe("Google");
    expect(original).toEqual(context.accounts);
  });
});
