// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TwofaSettingsPanel } from "./twofa-settings-panel";
import * as TwofaProviderModule from "./TwofaProvider";
import type { TwofaVaultStatus } from "@/lib/api";

afterEach(() => {
  cleanup();
});

vi.mock("./TwofaProvider", () => ({
  useTwofa: vi.fn(),
}));

const mockStatus: TwofaVaultStatus = {
  is_initialized: true,
  is_locked: false,
  has_vault: true,
  is_unlocked: true,
  session_id: "test-session-123",
  revision: 1,
  lock_enabled: true,
  pin_enabled: false,
  pin_failed_attempts: 0,
  pin_max_attempts: 5,
  is_pin_blocked: false,
  recovery_required: false,
  setup_cleanup_required: false,
  credential_store_status: "Available",
  lock_time_setting: "FiveMinutes",
  lock_on_screen_lock: true,
  hide_token_setting: "Never",
  clear_clipboard_setting: "ThirtySeconds",
  sort_order_setting: "ISSUER_ASC",
  account_count: 5,
  unassigned_count: 1,
  platform_capabilities: {
    can_detect_os_idle: true,
    can_detect_screen_lock: true,
    is_conservative_mode: false,
    idle_detection_note: null,
  },
};

function createMockContext(
  overrides: Partial<TwofaProviderModule.TwofaContextValue> = {},
): TwofaProviderModule.TwofaContextValue {
  return {
    status: mockStatus,
    isLoading: false,
    isUnlocked: true,
    isInitialized: true,
    hasVault: true,
    sessionId: "test-session-123",
    revision: 1,
    lockEnabled: true,
    pinEnabled: false,
    isPinBlocked: false,
    pinFailedAttempts: 0,
    pinMaxAttempts: 5,
    recoveryRequired: false,
    setupCleanupRequired: false,
    cleanupSetup: vi.fn(),
    isSavingSettings: false,
    credentialStoreStatus: "Available",
    accounts: [],
    codesBatch: null,
    codesByAccountId: {},
    isCodesError: false,
    revealedAccountIds: new Set(),
    toggleReveal: vi.fn(),
    clearRevealedAccounts: vi.fn(),
    refreshStatus: vi.fn(),
    refreshAccounts: vi.fn(),
    refreshCodes: vi.fn(),
    unlockVault: vi.fn(),
    unlockWithPin: vi.fn(),
    tryAutoUnlock: vi.fn(),
    lockVault: vi.fn(),
    setupVault: vi.fn(),
    setLockEnabled: vi.fn(),
    setPin: vi.fn(),
    removePin: vi.fn(),
    changePassword: vi.fn(),
    updateSettings: vi.fn(),
    copyCode: vi.fn(),
    retryRecovery: vi.fn(),
    ...overrides,
  };
}

describe("TwofaSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton when isLoading is true", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: null,
        isLoading: true,
        isUnlocked: false,
        isInitialized: false,
        hasVault: false,
        sessionId: null,
        revision: 0,
        credentialStoreStatus: "Untested",
      }),
    );

    const { container } = render(<TwofaSettingsPanel />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.queryByText("Kho mã 2FA chưa được thiết lập")).toBeNull();
  });

  it("renders setup callout when vault is not initialized", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: { ...mockStatus, has_vault: false, is_unlocked: false },
        isLoading: false,
        isUnlocked: false,
        isInitialized: false,
        hasVault: false,
        sessionId: null,
        revision: 0,
        credentialStoreStatus: "Untested",
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(screen.getByText("Kho mã 2FA chưa được thiết lập")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bắt đầu thiết lập kho mã" })).toBeTruthy();
  });

  it("renders locked banner when vault is locked", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: { ...mockStatus, has_vault: true, is_unlocked: false, session_id: null },
        isLoading: false,
        isUnlocked: false,
        isInitialized: true,
        hasVault: true,
        sessionId: null,
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(screen.getByText(/Kho mã đang khóa\. Các cài đặt bên dưới đang ở chế độ chỉ đọc/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mở khóa ngay/ })).toBeTruthy();
  });

  it("renders all 4 groups with active controls when unlocked", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: mockStatus,
        isUnlocked: true,
      }),
    );

    render(<TwofaSettingsPanel />);

    // 4 section headers
    expect(screen.getByText("Bảo vệ truy cập")).toBeTruthy();
    expect(screen.getByText("Tự khóa")).toBeTruthy();
    expect(screen.getByText("Hiển thị và clipboard")).toBeTruthy();
    expect(screen.getByText("Nhập và sao lưu")).toBeTruthy();

    // Access protection controls
    expect(screen.getByRole("button", { name: /Khóa ngay/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thiết lập PIN" })).toBeTruthy();

    // Backup actions
    expect(screen.getByRole("button", { name: /Nhập tài khoản\.\.\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Xuất file \.pr2fa\.\.\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Xuất không mã hóa\.\.\./ })).toBeTruthy();
  });

  it("shows disabled explanation for auto-lock when lock_enabled is false", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: { ...mockStatus, lock_enabled: false },
        lockEnabled: false,
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(
      screen.getByText(/Tính năng tự khóa đang tạm tắt vì bạn đã chọn chế độ/),
    ).toBeTruthy();
  });

  it("shows credential store warning when OS store is unavailable or missing credential", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: { ...mockStatus, credential_store_status: "MissingCredential" },
        lockEnabled: false,
        credentialStoreStatus: "MissingCredential",
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(
      screen.getByText(/Cảnh báo kho khóa hệ điều hành:/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Chìa khóa tự mở trong kho bí mật hệ điều hành không tìm thấy/),
    ).toBeTruthy();
  });

  it("shows recovery required warning banner when recovery_required is true", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        status: { ...mockStatus, recovery_required: true },
        recoveryRequired: true,
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(
      screen.getByText(/Phát hiện thao tác bảo mật bị gián đoạn:/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Thử lại khôi phục/ }),
    ).toBeTruthy();
  });

  it("disables interactive controls when isSavingSettings is true", () => {
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        isSavingSettings: true,
      }),
    );

    render(<TwofaSettingsPanel />);
    // Check that buttons like "Đổi mật khẩu" are disabled
    const changePasswordBtn = screen.getByRole("button", { name: "Đổi mật khẩu" });
    expect(changePasswordBtn).toHaveProperty("disabled", true);
  });

  it("shows cleanup warning banner when uninitialized and setupCleanupRequired is true", () => {
    const cleanupSetupMock = vi.fn();
    vi.mocked(TwofaProviderModule.useTwofa).mockReturnValue(
      createMockContext({
        hasVault: false,
        isUnlocked: false,
        isInitialized: false,
        setupCleanupRequired: true,
        cleanupSetup: cleanupSetupMock,
      }),
    );

    render(<TwofaSettingsPanel />);
    expect(
      screen.getByText(/Phát hiện thiết lập bị gián đoạn:/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Cần dọn dẹp khóa cũ trong kho bí mật trước khi bắt đầu thiết lập kho mã mới./),
    ).toBeTruthy();

    const cleanupBtn = screen.getByRole("button", { name: /Dọn dẹp ngay/ });
    expect(cleanupBtn).toBeTruthy();

    cleanupBtn.click();
    expect(cleanupSetupMock).toHaveBeenCalledTimes(1);

    const setupBtn = screen.getByRole("button", { name: /Bắt đầu thiết lập kho mã/ });
    expect(setupBtn).toHaveProperty("disabled", true);
  });
});
