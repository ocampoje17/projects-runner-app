import { useState, useEffect, type ReactNode } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Eye,
  Download,
  Upload,
  AlertTriangle,
  RefreshCw,
  Clock,
} from "lucide-react";
import {
  type TwofaVaultSettings,
  type LockTimeSetting,
  type HideTokenSetting,
  type ClearClipboardSetting,
  type SortOrderSetting,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useTwofa } from "./TwofaProvider";
import { TwofaLockDialog, type TwofaLockDialogMode } from "./twofa-lock-dialog";
import { TwofaExportDialog, type TwofaExportMode } from "./twofa-export-dialog";
import { TwofaImportDialog } from "./twofa-import-dialog";
import { ConfirmDialog } from "@/components/process-dialogs";
import { cn } from "@/lib/utils";

function SettingsSection({
  icon,
  title,
  description,
  children,
  action,
  tone = "default",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section className="border-b border-[var(--vscode-border)] pb-6 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 shrink-0 text-[var(--vscode-icon)]",
              tone === "danger" ? "text-destructive" : "text-primary",
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
            <p className="text-[12px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-[var(--vscode-border)] py-3 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <h4 className="text-[12.5px] font-semibold text-foreground">{title}</h4>
        {description ? <div className="text-[11.5px] text-muted-foreground mt-0.5">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function TwofaSettingsPanel() {
  const {
    status,
    isLoading,
    isUnlocked,
    hasVault,
    lockEnabled,
    pinEnabled,
    isPinBlocked,
    pinFailedAttempts,
    setupCleanupRequired,
    cleanupSetup,
    credentialStoreStatus,
    isSavingSettings,
    clearRevealedAccounts,
    refreshStatus,
    lockVault,
    updateSettings,
  } = useTwofa();

  // Dialog states
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [lockDialogMode, setLockDialogMode] = useState<TwofaLockDialogMode>("unlock");
  const [targetLockEnabled, setTargetLockEnabled] = useState(true);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogMode, setExportDialogMode] = useState<TwofaExportMode>("encrypted");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [plaintextConfirmOpen, setPlaintextConfirmOpen] = useState(false);

  // Group-specific saving & error state
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<{ group: string; message: string } | null>(null);

  // Auto-close sensitive non-unlock dialogs when an existing vault locks
  useEffect(() => {
    if (hasVault && !isUnlocked) {
      if (lockDialogOpen && lockDialogMode !== "unlock" && lockDialogMode !== "retry-recovery") {
        setLockDialogOpen(false);
      }
      setExportDialogOpen(false);
      setImportDialogOpen(false);
      setPlaintextConfirmOpen(false);
    }
  }, [hasVault, isUnlocked, lockDialogOpen, lockDialogMode]);

  const isBusy = !isUnlocked || isSavingSettings || savingGroup !== null;

  const handleUpdate = async (
    groupName: string,
    patch: Partial<TwofaVaultSettings>,
  ) => {
    if (!status || !status.session_id) return;
    if (patch.hide_token_setting !== undefined) {
      clearRevealedAccounts();
    }
    setSavingGroup(groupName);
    setGroupError(null);
    try {
      const current: TwofaVaultSettings = {
        lock_time_setting: status.lock_time_setting,
        lock_on_screen_lock: status.lock_on_screen_lock,
        hide_token_setting: status.hide_token_setting,
        clear_clipboard_setting: status.clear_clipboard_setting,
        sort_order_setting: status.sort_order_setting,
      };
      await updateSettings({ ...current, ...patch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGroupError({ group: groupName, message: msg });
    } finally {
      setSavingGroup(null);
    }
  };

  // 1. Loading Skeleton
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 rounded-lg bg-[var(--vscode-input-background,#252526)] opacity-40" />
        <div className="h-36 rounded-lg bg-[var(--vscode-input-background,#252526)] opacity-40" />
        <div className="h-32 rounded-lg bg-[var(--vscode-input-background,#252526)] opacity-40" />
      </div>
    );
  }

  // 2. Failed to load status
  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center p-8 rounded-lg border border-destructive/30 bg-destructive/5 text-center gap-3">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div>
          <h4 className="text-sm font-semibold">Không thể đọc trạng thái kho 2FA</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Đã xảy ra lỗi khi kết nối tới dịch vụ quản lý kho mã xác thực.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshStatus()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Thử lại
        </Button>
      </div>
    );
  }

  // 3. Vault Not Initialized
  if (!hasVault) {
    return (
      <div className="space-y-6">
        {setupCleanupRequired && (
          <div className="flex items-center justify-between p-3.5 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <span className="font-semibold">Phát hiện thiết lập bị gián đoạn: </span>
                Cần dọn dẹp khóa cũ trong kho bí mật trước khi bắt đầu thiết lập kho mã mới.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await cleanupSetup();
                } catch (e) {
                  console.error("Cleanup setup failed:", e);
                }
              }}
              className="shrink-0 ml-3"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Dọn dẹp ngay
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-6 text-center flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-semibold text-foreground">Kho mã 2FA chưa được thiết lập</h3>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Bảo vệ các tài khoản xác thực hai bước (TOTP) và tạo mã bảo mật cho các dự án của bạn.
              Dữ liệu được mã hóa an toàn trên thiết bị của bạn.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={setupCleanupRequired}
            onClick={() => {
              setLockDialogMode("setup");
              setLockDialogOpen(true);
            }}
          >
            Bắt đầu thiết lập kho mã
          </Button>
        </div>

        {/* Lock Dialog */}
        <TwofaLockDialog
          open={lockDialogOpen}
          onOpenChange={setLockDialogOpen}
          mode={lockDialogMode}
          onSuccess={() => void refreshStatus()}
        />
      </div>
    );
  }

  // Platform capability notes
  const canDetectScreenLock = status.platform_capabilities?.can_detect_screen_lock ?? false;
  const isConservativeLinux = status.platform_capabilities?.is_conservative_mode ?? false;

  return (
    <div className="space-y-6">
      {/* Vault Locked Banner (Read-only mode notice) */}
      {!isUnlocked && (
        <div className="flex items-center justify-between p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 shrink-0" />
            <span>Kho mã đang khóa. Các cài đặt bên dưới đang ở chế độ chỉ đọc. Hãy mở khóa để chỉnh sửa hoặc sao lưu.</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setLockDialogMode("unlock");
              setLockDialogOpen(true);
            }}
            className="shrink-0 ml-3"
          >
            <Unlock className="h-3.5 w-3.5 mr-1" /> Mở khóa ngay
          </Button>
        </div>
      )}

      {/* Recovery Required Warning Banner */}
      {status.recovery_required && (
        <div className="flex items-center justify-between p-3.5 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>
              <span className="font-semibold">Phát hiện thao tác bảo mật bị gián đoạn: </span>
              Kho mã cần được khôi phục bằng mật khẩu chính để dọn dẹp cấu hình cũ và bảo đảm an toàn.
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setLockDialogMode("retry-recovery");
              setLockDialogOpen(true);
            }}
            className="shrink-0 ml-3"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Thử lại khôi phục
          </Button>
        </div>
      )}

      {/* Credential Store Warning */}
      {(credentialStoreStatus === "Unavailable" ||
        credentialStoreStatus === "LockedOrDenied" ||
        credentialStoreStatus === "MissingCredential") && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Cảnh báo kho khóa hệ điều hành: </span>
            {credentialStoreStatus === "MissingCredential"
              ? "Chìa khóa tự mở trong kho bí mật hệ điều hành không tìm thấy. Ứng dụng sẽ yêu cầu mật khẩu chính để mở khóa."
              : credentialStoreStatus === "LockedOrDenied"
                ? "Truy cập kho bảo mật hệ điều hành bị từ chối hoặc bị khóa. Hãy cấp quyền truy cập để dùng tính năng tự mở hoặc PIN."
                : "Kho bảo mật hệ điều hành hiện không khả dụng trên thiết bị này."}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* NHÓM 1: BẢO VỆ TRUY CẬP */}
      {/* ===================================================================== */}
      <SettingsSection
        icon={<ShieldCheck size={16} />}
        title="Bảo vệ truy cập"
        description="Quản lý phương thức mở khóa, mật khẩu chính và mã PIN bảo vệ kho 2FA"
      >
        {groupError?.group === "access" && (
          <div className="mb-2 p-2 rounded bg-destructive/10 text-xs text-destructive">
            {groupError.message}
          </div>
        )}

        {/* Trạng thái kho */}
        <SettingsRow
          title="Trạng thái kho"
          description={
            isUnlocked
              ? `Kho mã đang mở (${status.account_count ?? 0} tài khoản).`
              : "Kho mã đang khóa."
          }
        >
          <div className="flex items-center gap-2">
            <Badge variant={isUnlocked ? "success" : "muted"}>
              {isUnlocked ? "Đã mở" : "Đang khóa"}
            </Badge>
            {isUnlocked && lockEnabled && (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={async () => {
                  await lockVault();
                }}
              >
                <Lock className="h-3 w-3 mr-1" /> Khóa ngay
              </Button>
            )}
          </div>
        </SettingsRow>

        {/* Khóa kho mã 2FA */}
        <SettingsRow
          title="Khóa kho mã 2FA"
          description={
            lockEnabled
              ? "Yêu cầu mở khóa khi mở ứng dụng. Kho mã tự khóa khi hết thời gian chờ."
              : "Không khóa. Chìa khóa được bảo vệ bởi hệ điều hành, tự mở xem mã ngay khi vào app."
          }
        >
          <Switch
            checked={lockEnabled}
            disabled={isBusy}
            onCheckedChange={(checked) => {
              setTargetLockEnabled(checked);
              setLockDialogMode("toggle-lock");
              setLockDialogOpen(true);
            }}
          />
        </SettingsRow>

        {/* Mật khẩu chính */}
        <SettingsRow
          title="Mật khẩu chính"
          description="Dùng để xác thực các thay đổi bảo mật và phương thức mở khóa dự phòng."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              setLockDialogMode("change-password");
              setLockDialogOpen(true);
            }}
          >
            Đổi mật khẩu
          </Button>
        </SettingsRow>

        {/* Mã PIN 6 số */}
        <SettingsRow
          title="Mã PIN 6 số"
          description={
            !lockEnabled ? (
              <span className="text-muted-foreground">
                Mã PIN chỉ khả dụng khi bật chế độ Khóa kho mã.
              </span>
            ) : pinEnabled ? (
              isPinBlocked ? (
                <span className="text-destructive font-medium">
                  PIN đã bị khóa do nhập sai quá 5 lần. Hãy mở bằng mật khẩu chính để đặt lại.
                </span>
              ) : pinFailedAttempts > 0 ? (
                <span className="text-amber-500 font-medium">
                  Đang bật PIN. Đã nhập sai {pinFailedAttempts}/5 lần.
                </span>
              ) : (
                "Đang bật mở khóa nhanh bằng PIN 6 số."
              )
            ) : (
              "Chưa thiết lập. Có thể bật mã PIN 6 số để mở khóa nhanh hàng ngày."
            )
          }
        >
          {lockEnabled && isUnlocked ? (
            <div className="flex items-center gap-2">
              {pinEnabled ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setLockDialogMode("set-pin");
                      setLockDialogOpen(true);
                    }}
                  >
                    Đổi PIN
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setLockDialogMode("remove-pin");
                      setLockDialogOpen(true);
                    }}
                  >
                    Xóa PIN
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    setLockDialogMode("set-pin");
                    setLockDialogOpen(true);
                  }}
                >
                  Thiết lập PIN
                </Button>
              )}
            </div>
          ) : (
            <Badge variant="muted">
              {pinEnabled ? "Đã bật PIN" : "Chưa bật PIN"}
            </Badge>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* ===================================================================== */}
      {/* NHÓM 2: TỰ KHÓA */}
      {/* ===================================================================== */}
      <SettingsSection
        icon={<Clock size={16} />}
        title="Tự khóa"
        description="Quy định điều kiện và thời gian kho mã tự động khóa khi không có tương tác"
      >
        {groupError?.group === "autolock" && (
          <div className="mb-2 p-2 rounded bg-destructive/10 text-xs text-destructive">
            {groupError.message}
          </div>
        )}

        {!lockEnabled && (
          <div className="mb-3 p-2.5 rounded bg-[var(--vscode-input-background,#252526)] text-xs text-muted-foreground">
            Tính năng tự khóa đang tạm tắt vì bạn đã chọn chế độ <strong>Không khóa</strong>. Các thiết lập dưới đây vẫn được lưu và sẽ áp dụng nếu bạn bật lại khóa.
          </div>
        )}

        {/* Thời gian không hoạt động */}
        <SettingsRow
          title="Thời gian không hoạt động"
          description="Tự động khóa kho mã sau một khoảng thời gian người dùng không tương tác."
        >
          <Select
            value={status.lock_time_setting}
            disabled={!lockEnabled || isBusy}
            onValueChange={(val) => {
              void handleUpdate("autolock", {
                lock_time_setting: val as LockTimeSetting,
              });
            }}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Never">Không bao giờ</SelectItem>
              <SelectItem value="ThirtySeconds">30 giây</SelectItem>
              <SelectItem value="OneMinute">1 phút</SelectItem>
              <SelectItem value="FiveMinutes">5 phút (Mặc định)</SelectItem>
              <SelectItem value="TenMinutes">10 phút</SelectItem>
              <SelectItem value="ThirtyMinutes">30 phút</SelectItem>
              <SelectItem value="OneHour">1 giờ</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {/* Khóa khi khóa màn hình hoặc sleep */}
        <SettingsRow
          title="Khóa khi khóa màn hình hoặc sleep"
          description={
            canDetectScreenLock ? (
              "Tự động khóa ngay khi máy tính bị khóa màn hình hoặc chuyển sang chế độ ngủ."
            ) : isConservativeLinux ? (
              <span className="text-amber-500">
                Linux: Khóa khi mất tiêu điểm cửa sổ để bảo vệ dữ liệu (do giới hạn phát hiện màn hình của hệ điều hành).
              </span>
            ) : (
              <span className="text-muted-foreground">
                macOS/Linux: Hệ điều hành không hỗ trợ phát hiện khóa màn hình trực tiếp. Khóa khi sleep và khóa theo thời gian không hoạt động vẫn áp dụng bình thường.
              </span>
            )
          }
        >
          <Switch
            checked={status.lock_on_screen_lock}
            disabled={!lockEnabled || isBusy}
            onCheckedChange={(checked) => {
              void handleUpdate("autolock", { lock_on_screen_lock: checked });
            }}
          />
        </SettingsRow>
      </SettingsSection>

      {/* ===================================================================== */}
      {/* NHÓM 3: HIỂN THỊ VÀ CLIPBOARD */}
      {/* ===================================================================== */}
      <SettingsSection
        icon={<Eye size={16} />}
        title="Hiển thị và clipboard"
        description="Cách hiển thị mã 6 số và cơ chế bảo vệ mã khi sao chép"
      >
        {groupError?.group === "display" && (
          <div className="mb-2 p-2 rounded bg-destructive/10 text-xs text-destructive">
            {groupError.message}
          </div>
        )}

        {/* Hiển thị mã */}
        <SettingsRow
          title="Hiển thị mã xác thực"
          description="Kiểm soát khả năng đọc trực tiếp mã OTP trên màn hình."
        >
          <Select
            value={status.hide_token_setting}
            disabled={isBusy}
            onValueChange={(val) => {
              void handleUpdate("display", {
                hide_token_setting: val as HideTokenSetting,
              });
            }}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Never">Luôn hiển thị (Mặc định)</SelectItem>
              <SelectItem value="ShowAfterClick">Hiện mã khi nhấn</SelectItem>
              <SelectItem value="Always">Luôn ẩn (Chỉ cho chép)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {/* Thời gian xóa clipboard */}
        <SettingsRow
          title="Thời gian xóa mã khỏi clipboard"
          description="Tự động dọn dẹp mã TOTP vừa sao chép khỏi clipboard hệ thống."
        >
          <Select
            value={status.clear_clipboard_setting}
            disabled={isBusy}
            onValueChange={(val) => {
              void handleUpdate("display", {
                clear_clipboard_setting: val as ClearClipboardSetting,
              });
            }}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Disabled">Tắt (Không xóa)</SelectItem>
              <SelectItem value="TenSeconds">10 giây</SelectItem>
              <SelectItem value="TwentySeconds">20 giây</SelectItem>
              <SelectItem value="ThirtySeconds">30 giây (Mặc định)</SelectItem>
              <SelectItem value="OneMinute">1 phút</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {/* Thứ tự tài khoản */}
        <SettingsRow
          title="Thứ tự tài khoản mặc định"
          description="Sắp xếp danh sách tài khoản 2FA trong kho và thanh bên Explorer."
        >
          <Select
            value={status.sort_order_setting}
            disabled={isBusy}
            onValueChange={(val) => {
              void handleUpdate("display", {
                sort_order_setting: val as SortOrderSetting,
              });
            }}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ISSUER_ASC">Tên dịch vụ (A–Z)</SelectItem>
              <SelectItem value="ISSUER_DESC">Tên dịch vụ (Z–A)</SelectItem>
              <SelectItem value="CREATED_DESC">Mới nhất trước</SelectItem>
              <SelectItem value="CREATED_ASC">Cũ nhất trước</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      {/* ===================================================================== */}
      {/* NHÓM 4: NHẬP VÀ SAO LƯU */}
      {/* ===================================================================== */}
      <SettingsSection
        icon={<Download size={16} />}
        title="Nhập và sao lưu"
        description="Xuất file dự phòng có mã hóa, xuất dữ liệu và nhập tài khoản"
      >
        <SettingsRow
          title="Nhập tài khoản"
          description="Quét mã QR từ màn hình, file ảnh hoặc nhập danh sách đường dẫn otpauth."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => setImportDialogOpen(true)}
          >
            <Upload className="h-3.5 w-3.5 mr-1" /> Nhập tài khoản...
          </Button>
        </SettingsRow>

        <SettingsRow
          title="Sao lưu có mã hóa (.pr2fa)"
          description="Được bảo vệ bằng mật khẩu dự phòng độc lập, an toàn để lưu trữ hoặc di chuyển."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              setExportDialogMode("encrypted");
              setExportDialogOpen(true);
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" /> Xuất file .pr2fa...
          </Button>
        </SettingsRow>

        <SettingsRow
          title="Xuất dữ liệu không mã hóa"
          description="Xuất file JSON rõ không có mật khẩu bảo vệ. Khuyên dùng chỉ khi di chuyển dữ liệu."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => setPlaintextConfirmOpen(true)}
            className="text-destructive hover:bg-destructive/10"
          >
            Xuất không mã hóa...
          </Button>
        </SettingsRow>
      </SettingsSection>

      {/* Lock Dialog */}
      <TwofaLockDialog
        open={lockDialogOpen}
        onOpenChange={setLockDialogOpen}
        mode={lockDialogMode}
        targetLockEnabled={targetLockEnabled}
        onSuccess={() => void refreshStatus()}
      />

      {/* Import Dialog */}
      {importDialogOpen && (
        <TwofaImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onImported={() => void refreshStatus()}
        />
      )}

      {/* Export Dialog */}
      {exportDialogOpen && (
        <TwofaExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          mode={exportDialogMode}
        />
      )}

      {/* Plaintext Export Warning Confirmation */}
      <ConfirmDialog
        open={plaintextConfirmOpen}
        onOpenChange={setPlaintextConfirmOpen}
        title="Xác nhận xuất dữ liệu không mã hóa"
        description="File xuất ra sẽ chứa toàn bộ mã bí mật 2FA dưới dạng văn bản rõ không có mật khẩu bảo vệ. Bất kỳ ai có file này đều có thể tạo mã OTP đăng nhập tài khoản của bạn. Bạn có chắc chắn muốn tiếp tục?"
        confirmLabel="Tôi hiểu rủi ro, tiếp tục xuất"
        cancelLabel="Hủy"
        isDestructive={true}
        onConfirm={() => {
          setPlaintextConfirmOpen(false);
          setExportDialogMode("plaintext");
          setExportDialogOpen(true);
        }}
      />
    </div>
  );
}
