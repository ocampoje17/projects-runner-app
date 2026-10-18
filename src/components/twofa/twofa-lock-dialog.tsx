import { useState, useEffect, useRef } from "react";
import { KeyRound, Lock, Unlock, Loader2, ShieldCheck, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PinInput } from "./pin-input";
import { useTwofa } from "./TwofaProvider";
import { api } from "@/lib/api";

export type TwofaLockDialogMode =
  | "setup"
  | "unlock"
  | "change-password"
  | "set-pin"
  | "remove-pin"
  | "toggle-lock"
  | "retry-recovery";

export type TwofaLockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TwofaLockDialogMode;
  targetLockEnabled?: boolean; // For toggle-lock mode
  onSuccess?: () => void;
};

export function TwofaLockDialog({
  open,
  onOpenChange,
  mode,
  targetLockEnabled = true,
  onSuccess,
}: TwofaLockDialogProps) {
  const {
    status,
    unlockVault,
    unlockWithPin,
    setupVault,
    setLockEnabled,
    setPin,
    removePin,
    changePassword,
    retryRecovery,
  } = useTwofa();

  // Mode & Wizard Step State
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [setupAccessMode, setSetupAccessMode] = useState<"unlocked" | "locked">("unlocked");
  const [setupWantPin, setSetupWantPin] = useState(false);

  // Form input fields
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // PIN input states (supports 2-step PIN entry)
  const [unlockUsePin, setUnlockUsePin] = useState(true);
  const [pinValue, setPinValue] = useState("");
  const [pinConfirmValue, setPinConfirmValue] = useState("");
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const isAutoSubmittingRef = useRef(false);
  const dialogInstanceRef = useRef(0);
  const operationIdRef = useRef<string | null>(null);
  type RequestState = "idle" | "pending" | "succeeded" | "cancelled";
  const requestStateRef = useRef<RequestState>("idle");

  const isPinBlocked = Boolean(status?.is_pin_blocked);
  const pinEnabled = Boolean(status?.pin_enabled);

  // Reset dialog state on open/close
  useEffect(() => {
    dialogInstanceRef.current += 1;
    if (open) {
      requestStateRef.current = "idle";
      if (mode === "unlock") {
        operationIdRef.current =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `op-${Date.now()}-${Math.random()}`;
      } else {
        operationIdRef.current = null;
      }

      setSetupStep(1);
      setSetupAccessMode("unlocked");
      setSetupWantPin(false);
      setPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setShowPassword(false);
      setPinValue("");
      setPinConfirmValue("");
      setPinStep("enter");
      setError(null);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      isAutoSubmittingRef.current = false;

      if (mode === "unlock") {
        setUnlockUsePin(Boolean(status?.pin_enabled && !status?.is_pin_blocked));
      }
    } else {
      if (mode === "unlock" && operationIdRef.current && requestStateRef.current === "pending") {
        const opToCancel = operationIdRef.current;
        operationIdRef.current = null;
        requestStateRef.current = "cancelled";
        void api.twofaCancelAuth(opToCancel).catch(() => {});
      }
      setPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setPinValue("");
      setPinConfirmValue("");
      setError(null);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      isAutoSubmittingRef.current = false;
    }
  }, [open, mode]);

  useEffect(() => {
    return () => {
      if (mode === "unlock" && operationIdRef.current && requestStateRef.current === "pending") {
        const opToCancel = operationIdRef.current;
        operationIdRef.current = null;
        requestStateRef.current = "cancelled";
        void api.twofaCancelAuth(opToCancel).catch(() => {});
      }
    };
  }, [mode]);

  const handlePinConfirmComplete = (confirmVal: string) => {
    if (confirmVal.length !== 6) return;
    if (confirmVal !== pinValue) {
      setError("Mã PIN xác nhận không khớp. Vui lòng thử lại.");
      setPinConfirmValue("");
      return;
    }
    setError(null);

    // In set-pin mode: if master password was already entered, auto submit immediately
    if (mode === "set-pin" && currentPassword && !isSubmitting && !isSubmittingRef.current && !isAutoSubmittingRef.current) {
      isAutoSubmittingRef.current = true;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      void (async () => {
        try {
          await setPin(pinValue, currentPassword);
          onSuccess?.();
          onOpenChange(false);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : String(err));
          setPinConfirmValue("");
        } finally {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
          isAutoSubmittingRef.current = false;
        }
      })();
    }
  };

  const handleSetupPinConfirmComplete = (confirmVal: string) => {
    if (confirmVal.length !== 6) return;
    if (confirmVal !== pinValue) {
      setError("Mã PIN xác nhận không khớp. Vui lòng thử lại.");
      setPinConfirmValue("");
    } else {
      setError(null);
    }
  };

  // UNLOCK: Handle PIN Submission
  const handlePinUnlock = async (pinToSubmit: string) => {
    if (isSubmitting || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const instanceId = dialogInstanceRef.current;
    const opId = operationIdRef.current;
    requestStateRef.current = "pending";
    setError(null);
    setIsSubmitting(true);
    try {
      await unlockWithPin(pinToSubmit, opId);
      if (dialogInstanceRef.current !== instanceId) return;
      requestStateRef.current = "succeeded";
      operationIdRef.current = null;
      onSuccess?.();
      onOpenChange(false);
    } catch (err: unknown) {
      if (dialogInstanceRef.current !== instanceId) return;
      requestStateRef.current = "idle";
      operationIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `op-${Date.now()}-${Math.random()}`;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("PIN_BLOCKED")) {
        setError("Đã nhập sai PIN quá 5 lần. Vui lòng mở khóa bằng mật khẩu chính.");
        setUnlockUsePin(false);
      } else {
        setError(msg.replace(/^INVALID_PIN:\s*/, ""));
      }
      setPinValue("");
    } finally {
      if (dialogInstanceRef.current === instanceId) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  // Main Submit Handler
  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (isSubmitting || isSubmittingRef.current) return;
    setError(null);

    // 1. SETUP WIZARD
    if (mode === "setup") {
      if (setupStep === 1) {
        // Validate password
        if ([...password].length < 8) {
          setError("Mật khẩu chính phải có ít nhất 8 ký tự.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Mật khẩu xác nhận không khớp.");
          return;
        }
        setSetupStep(2);
        return;
      }

      // Step 2: Finalize setup
      let finalPin: string | null = null;
      if (setupAccessMode === "locked" && setupWantPin) {
        if (pinValue.length !== 6 || pinConfirmValue.length !== 6) {
          setError("Vui lòng nhập đủ 6 số cho mã PIN.");
          return;
        }
        if (pinValue !== pinConfirmValue) {
          setError("Mã PIN xác nhận không khớp.");
          return;
        }
        finalPin = pinValue;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      const instanceId = dialogInstanceRef.current;
      try {
        await setupVault(password, setupAccessMode === "locked", finalPin, null);
        if (dialogInstanceRef.current !== instanceId) return;
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        if (dialogInstanceRef.current !== instanceId) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (dialogInstanceRef.current === instanceId) {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    }

    // 2. UNLOCK
    else if (mode === "unlock") {
      if (unlockUsePin && !isPinBlocked) {
        if (pinValue.length === 6) {
          await handlePinUnlock(pinValue);
        }
        return;
      }

      if (!password) {
        setError("Vui lòng nhập mật khẩu chính.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      const instanceId = dialogInstanceRef.current;
      const opId = operationIdRef.current;
      requestStateRef.current = "pending";
      try {
        await unlockVault(password, opId);
        if (dialogInstanceRef.current !== instanceId) return;
        requestStateRef.current = "succeeded";
        operationIdRef.current = null;
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        if (dialogInstanceRef.current !== instanceId) return;
        requestStateRef.current = "idle";
        operationIdRef.current =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `op-${Date.now()}-${Math.random()}`;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (dialogInstanceRef.current === instanceId) {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    }

    // 3. SET OR CHANGE PIN
    else if (mode === "set-pin") {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu chính.");
        return;
      }
      if (pinValue.length !== 6 || pinConfirmValue.length !== 6) {
        setError("Vui lòng nhập đầy đủ 6 số cho mã PIN.");
        return;
      }
      if (pinValue !== pinConfirmValue) {
        setError("Mã PIN xác nhận không khớp.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await setPin(pinValue, currentPassword);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }

    // 4. REMOVE PIN
    else if (mode === "remove-pin") {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu chính.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await removePin(currentPassword);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }

    // 5. TOGGLE LOCK MODE
    else if (mode === "toggle-lock") {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu chính.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await setLockEnabled(targetLockEnabled, currentPassword);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }

    // 6. CHANGE MASTER PASSWORD
    else if (mode === "change-password") {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu chính hiện tại.");
        return;
      }
      if ([...password].length < 8) {
        setError("Mật khẩu mới phải có ít nhất 8 ký tự.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Mật khẩu mới xác nhận không khớp.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await changePassword(currentPassword, password);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }

    // 7. RETRY RECOVERY
    else if (mode === "retry-recovery") {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu chính.");
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await retryRecovery(currentPassword);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  const dialogTitle =
    mode === "setup"
      ? setupStep === 1
        ? "Thiết lập kho mã 2FA"
        : "Chọn phương thức truy cập"
      : mode === "unlock"
        ? unlockUsePin
          ? "Nhập mã PIN 6 số"
          : "Mở khóa kho 2FA"
        : mode === "set-pin"
          ? status?.pin_enabled
            ? "Đổi mã PIN"
            : "Thiết lập mã PIN 6 số"
          : mode === "remove-pin"
            ? "Xóa mã PIN"
            : mode === "toggle-lock"
              ? targetLockEnabled
                ? "Bật chế độ khóa kho mã"
                : "Tắt chế độ khóa kho mã"
              : mode === "retry-recovery"
                ? "Khôi phục kho mã"
                : "Đổi mật khẩu chính";

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      if (isSubmitting || isSubmittingRef.current) {
        return;
      }
      if (mode === "unlock" && operationIdRef.current && requestStateRef.current === "pending") {
        const opToCancel = operationIdRef.current;
        operationIdRef.current = null;
        requestStateRef.current = "cancelled";
        void api.twofaCancelAuth(opToCancel).catch(() => {});
      }
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md bg-[var(--vscode-panel)] border-[var(--vscode-border)] text-[var(--vscode-foreground)] p-5"
        onEscapeKeyDown={(e) => {
          if (isSubmitting || isSubmittingRef.current) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isSubmitting || isSubmittingRef.current) e.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-color)]/10 text-[var(--primary-color)]">
              {mode === "setup" ? (
                <ShieldCheck className="h-4 w-4" />
              ) : mode === "unlock" ? (
                <Lock className="h-4 w-4" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
            </div>
            <DialogTitle className="text-base font-semibold">{dialogTitle}</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {mode === "setup" && setupStep === 1 && (
              "Mật khẩu chính bảo vệ kho mã của bạn và dùng làm phương thức mở dự phòng."
            )}
            {mode === "setup" && setupStep === 2 && (
              "Chọn cách mở kho mã khi khởi động ứng dụng."
            )}
            {mode === "unlock" && unlockUsePin && (
              "Nhập mã PIN 6 số đã thiết lập để xem mã 2FA."
            )}
            {mode === "unlock" && !unlockUsePin && (
              "Nhập mật khẩu chính để mở khóa kho mã 2FA."
            )}
            {mode === "set-pin" && (
              "Nhập mật khẩu chính và thiết lập mã PIN 6 số mới."
            )}
            {mode === "remove-pin" && (
              "Sau khi xóa PIN, kho mã sẽ mở bằng mật khẩu chính."
            )}
            {mode === "toggle-lock" && targetLockEnabled && (
              "Bật khóa sẽ yêu cầu mở khóa mỗi khi khởi động ứng dụng. Kho mã sẽ khóa ngay sau thao tác này."
            )}
            {mode === "toggle-lock" && !targetLockEnabled && (
              "Tắt khóa sẽ lưu an toàn chìa khóa vào kho bảo mật hệ điều hành để tự động mở xem mã ngay khi mở app."
            )}
            {mode === "change-password" && (
              "Đổi mật khẩu chính sẽ xóa mã PIN hiện tại (nếu có). Bạn có thể thiết lập lại PIN sau."
            )}
            {mode === "retry-recovery" && (
              "Nhập mật khẩu chính để dọn dẹp các thông tin chuyển tiếp bị gián đoạn và khôi phục kho mã về trạng thái an toàn."
            )}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* 1. UNLOCK MODE */}
        {mode === "unlock" && (
          <div className="flex flex-col gap-4 py-2">
            {unlockUsePin && !isPinBlocked ? (
              <div className="flex flex-col items-center gap-4">
                <PinInput
                  value={pinValue}
                  onChange={setPinValue}
                  onComplete={handlePinUnlock}
                  disabled={isSubmitting}
                  error={Boolean(error)}
                />

                <div className="flex items-center justify-between w-full pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === "unlock" && operationIdRef.current && requestStateRef.current === "pending") {
                        const opToCancel = operationIdRef.current;
                        requestStateRef.current = "cancelled";
                        void api.twofaCancelAuth(opToCancel).catch(() => {});
                      }
                      operationIdRef.current =
                        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                          ? crypto.randomUUID()
                          : `op-${Date.now()}-${Math.random()}`;
                      requestStateRef.current = "idle";
                      setUnlockUsePin(false);
                      setPinValue("");
                      setError(null);
                    }}
                    className="text-xs text-[var(--vscode-textLink-foreground,#3794ff)] hover:underline"
                  >
                    Dùng mật khẩu chính
                  </button>

                  {status && status.pin_failed_attempts > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Còn {Math.max(0, 5 - status.pin_failed_attempts)} lần thử
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="master-pwd" className="text-xs font-medium">
                    Mật khẩu chính
                  </Label>
                  <div className="relative">
                    <Input
                      id="master-pwd"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-8 pr-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-2 text-muted-foreground hover:text-[var(--vscode-foreground)]"
                      onClick={() => setShowPassword((prev) => !prev)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  {pinEnabled && !isPinBlocked ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (mode === "unlock" && operationIdRef.current && requestStateRef.current === "pending") {
                          const opToCancel = operationIdRef.current;
                          requestStateRef.current = "cancelled";
                          void api.twofaCancelAuth(opToCancel).catch(() => {});
                        }
                        operationIdRef.current =
                          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                            ? crypto.randomUUID()
                            : `op-${Date.now()}-${Math.random()}`;
                        requestStateRef.current = "idle";
                        setUnlockUsePin(true);
                        setPassword("");
                        setError(null);
                      }}
                      className="text-xs text-[var(--vscode-textLink-foreground,#3794ff)] hover:underline"
                    >
                      Dùng mã PIN
                    </button>
                  ) : <span />}

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenChange(false)}
                    >
                      Đóng
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={isSubmitting || !password}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang kiểm tra...
                        </>
                      ) : (
                        <>
                          <Unlock className="h-3.5 w-3.5" /> Mở khóa
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* 2. SETUP WIZARD */}
        {mode === "setup" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 py-1">
            {setupStep === 1 ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="setup-pwd" className="text-xs font-medium">
                    Mật khẩu chính
                  </Label>
                  <div className="relative">
                    <Input
                      id="setup-pwd"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Tối thiểu 8 ký tự"
                      className="h-8 pr-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-2 text-muted-foreground hover:text-[var(--vscode-foreground)]"
                      onClick={() => setShowPassword((prev) => !prev)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="setup-confirm-pwd" className="text-xs font-medium">
                    Xác nhận mật khẩu chính
                  </Label>
                  <Input
                    id="setup-confirm-pwd"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={[...password].length < 8 || password !== confirmPassword}
                  >
                    Tiếp tục
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2.5 rounded-lg border border-[var(--vscode-border)] p-3 cursor-pointer hover:bg-[var(--vscode-list-hover)] transition-colors">
                    <input
                      type="radio"
                      name="accessMode"
                      checked={setupAccessMode === "unlocked"}
                      onChange={() => {
                        setSetupAccessMode("unlocked");
                        setSetupWantPin(false);
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-[var(--vscode-foreground)]">
                        Mở xem mã ngay (Mặc định)
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Chìa khóa được bảo vệ an toàn bởi hệ điều hành. Ứng dụng tự mở xem mã ngay khi khởi động.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 rounded-lg border border-[var(--vscode-border)] p-3 cursor-pointer hover:bg-[var(--vscode-list-hover)] transition-colors">
                    <input
                      type="radio"
                      name="accessMode"
                      checked={setupAccessMode === "locked"}
                      onChange={() => setSetupAccessMode("locked")}
                      className="mt-0.5"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-[var(--vscode-foreground)]">
                        Yêu cầu mở khóa
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Kho mã ở trạng thái khóa khi mở app. Yêu cầu nhập mã PIN hoặc mật khẩu chính để xem mã.
                      </span>
                    </div>
                  </label>
                </div>

                {setupAccessMode === "locked" && (
                  <div className="flex flex-col gap-3 rounded-lg border border-[var(--vscode-border)] p-3 bg-[var(--vscode-input-background)]/50">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={setupWantPin}
                        onChange={(e) => {
                          setSetupWantPin(e.target.checked);
                          setPinValue("");
                          setPinConfirmValue("");
                        }}
                        className="rounded"
                      />
                      <span className="text-xs font-medium">Bật mở khóa nhanh bằng mã PIN 6 số</span>
                    </label>

                    {setupWantPin && (
                      <div className="flex flex-col gap-2.5 pt-1">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">
                            {pinStep === "enter"
                              ? "1. Nhập mã PIN (6 số):"
                              : "2. Xác nhận lại mã PIN (6 số):"}
                          </span>
                          {pinStep === "enter" ? (
                            <PinInput
                              value={pinValue}
                              onChange={setPinValue}
                              onComplete={() => setPinStep("confirm")}
                              label="Mã PIN mới"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1.5">
                              <PinInput
                                value={pinConfirmValue}
                                onChange={setPinConfirmValue}
                                onComplete={handleSetupPinConfirmComplete}
                                label="Xác nhận mã PIN"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setPinStep("enter");
                                  setPinValue("");
                                  setPinConfirmValue("");
                                }}
                                className="text-[11px] text-[var(--vscode-textLink-foreground)] hover:underline"
                              >
                                Nhập lại từ đầu
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSetupStep(1)}
                    disabled={isSubmitting}
                  >
                    Quay lại
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={
                      isSubmitting ||
                      (setupAccessMode === "locked" &&
                        setupWantPin &&
                        (pinValue.length !== 6 || pinConfirmValue.length !== 6))
                    }
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tạo...
                      </>
                    ) : (
                      "Hoàn tất thiết lập"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}

        {/* 3. SET PIN / CHANGE PIN / REMOVE PIN / TOGGLE LOCK / CHANGE PASSWORD / RETRY RECOVERY */}
        {(mode === "set-pin" ||
          mode === "remove-pin" ||
          mode === "toggle-lock" ||
          mode === "change-password" ||
          mode === "retry-recovery") && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-master-pwd" className="text-xs font-medium">
                Mật khẩu chính hiện tại
              </Label>
              <div className="relative">
                <Input
                  id="confirm-master-pwd"
                  type={showPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="h-8 pr-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                  autoFocus
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 text-muted-foreground hover:text-[var(--vscode-foreground)]"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {mode === "set-pin" && (
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium">
                    {pinStep === "enter" ? "Nhập mã PIN 6 số:" : "Xác nhận mã PIN:"}
                  </span>
                  {pinStep === "enter" ? (
                    <PinInput
                      value={pinValue}
                      onChange={setPinValue}
                      onComplete={() => setPinStep("confirm")}
                      label="Mã PIN 6 số"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      <PinInput
                        value={pinConfirmValue}
                        onChange={setPinConfirmValue}
                        onComplete={handlePinConfirmComplete}
                        label="Xác nhận mã PIN"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPinStep("enter");
                          setPinValue("");
                          setPinConfirmValue("");
                        }}
                        className="text-[11px] text-[var(--vscode-textLink-foreground)] hover:underline"
                      >
                        Nhập lại mã PIN
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === "change-password" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-master-pwd" className="text-xs font-medium">
                    Mật khẩu chính mới
                  </Label>
                  <Input
                    id="new-master-pwd"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tối thiểu 8 ký tự"
                    className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-new-master-pwd" className="text-xs font-medium">
                    Xác nhận mật khẩu chính mới
                  </Label>
                  <Input
                    id="confirm-new-master-pwd"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={
                  isSubmitting ||
                  !currentPassword ||
                  (mode === "set-pin" && (pinValue.length !== 6 || pinConfirmValue.length !== 6)) ||
                  (mode === "change-password" && ([...password].length < 8 || password !== confirmPassword))
                }
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang xử lý...
                  </>
                ) : mode === "set-pin" ? (
                  "Lưu PIN"
                ) : mode === "remove-pin" ? (
                  "Xóa PIN"
                ) : mode === "toggle-lock" ? (
                  targetLockEnabled ? "Bật khóa" : "Tắt khóa"
                ) : mode === "retry-recovery" ? (
                  "Khôi phục ngay"
                ) : (
                  "Đổi mật khẩu"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
