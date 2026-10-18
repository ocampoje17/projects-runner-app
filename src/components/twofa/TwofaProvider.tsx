import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  isDesktopRuntime,
  parseTwofaSecurityError,
  type CredentialStoreStatus,
  type TwofaAccountSummary,
  type TwofaCodeBatch,
  type TwofaCodeItem,
  type TwofaCopyResult,
  type TwofaVaultSettings,
  type TwofaVaultStateChangedEvent,
  type TwofaVaultStatus,
} from "@/lib/api";

export interface TwofaContextValue {
  status: TwofaVaultStatus | null;
  isUnlocked: boolean;
  isInitialized: boolean;
  hasVault: boolean;
  sessionId: string | null;
  revision: number;
  lockEnabled: boolean;
  pinEnabled: boolean;
  isPinBlocked: boolean;
  pinFailedAttempts: number;
  pinMaxAttempts: number;
  recoveryRequired: boolean;
  setupCleanupRequired: boolean;
  credentialStoreStatus: CredentialStoreStatus;
  accounts: TwofaAccountSummary[];
  codesBatch: TwofaCodeBatch | null;
  codesByAccountId: Record<string, TwofaCodeItem>;
  isCodesError: boolean;
  isLoading: boolean;
  isSavingSettings: boolean;
  revealedAccountIds: Set<string>;
  toggleReveal: (accountId: string) => void;
  clearRevealedAccounts: () => void;
  refreshStatus: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshCodes: () => Promise<void>;
  unlockVault: (password: string, operationId?: string | null) => Promise<boolean>;
  unlockWithPin: (pin: string, operationId?: string | null) => Promise<boolean>;
  tryAutoUnlock: () => Promise<boolean>;
  lockVault: () => Promise<void>;
  cleanupSetup: () => Promise<void>;
  setupVault: (
    password: string,
    lockEnabled: boolean,
    pin?: string | null,
    settings?: TwofaVaultSettings | null,
  ) => Promise<boolean>;
  setLockEnabled: (lockEnabled: boolean, masterPassword: string) => Promise<boolean>;
  setPin: (pin: string, masterPassword: string) => Promise<boolean>;
  removePin: (masterPassword: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  retryRecovery: (masterPassword: string) => Promise<boolean>;
  updateSettings: (settings: TwofaVaultSettings) => Promise<TwofaVaultStatus>;
  copyCode: (accountId: string) => Promise<TwofaCopyResult>;
}

const TwofaContext = createContext<TwofaContextValue | null>(null);

export function TwofaProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TwofaVaultStatus | null>(null);
  const [accounts, setAccounts] = useState<TwofaAccountSummary[]>([]);
  const [codesBatch, setCodesBatch] = useState<TwofaCodeBatch | null>(null);
  const [isCodesError, setIsCodesError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const isSavingSettingsRef = useRef(false);
  const [revealedAccountIds, setRevealedAccountIds] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef<string | null>(null);
  const revisionRef = useRef<number>(0);
  const serverOffsetRef = useRef<number>(0);
  const statusRef = useRef<TwofaVaultStatus | null>(null);
  statusRef.current = status;

  const autoUnlockPromiseRef = useRef<Promise<boolean> | null>(null);

  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const purgeSensitiveData = useCallback(() => {
    sessionIdRef.current = null;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    setAccounts([]);
    setCodesBatch(null);
    setRevealedAccountIds(new Set());
    setIsCodesError(false);
  }, []);

  const clearRevealedAccounts = useCallback(() => {
    setRevealedAccountIds(new Set());
  }, []);

  const refreshAccounts = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    const activeRevision = revisionRef.current;
    if (!activeSession) {
      setAccounts([]);
      return;
    }
    try {
      const list = await api.twofaListAccounts(activeSession);
      if (sessionIdRef.current === activeSession && revisionRef.current === activeRevision) {
        setAccounts(list);
      }
    } catch {
      if (sessionIdRef.current === activeSession) {
        setAccounts([]);
      }
    }
  }, []);

  const refreshCodes = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    const activeRevision = revisionRef.current;
    if (!activeSession) {
      setCodesBatch(null);
      return;
    }
    try {
      const batch = await api.twofaGetCodes(activeSession);
      if (sessionIdRef.current === activeSession && revisionRef.current === activeRevision) {
        const localNowSecs = Math.floor(Date.now() / 1000);
        serverOffsetRef.current = batch.server_time - localNowSecs;
        setCodesBatch(batch);
        setIsCodesError(false);
        retryCountRef.current = 0;
      }
    } catch {
      if (sessionIdRef.current === activeSession) {
        setCodesBatch(null);
        setIsCodesError(true);
        if (retryCountRef.current < 3) {
          retryCountRef.current += 1;
          const delay = Math.pow(2, retryCountRef.current - 1) * 1000;
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            void refreshCodes();
          }, delay);
        }
      }
    }
  }, []);

  // Centralized function to apply status updates consistently across all flows
  const applyVaultStatus = useCallback(
    (nextStatus: TwofaVaultStatus, force?: boolean) => {
      if (!force && revisionRef.current > nextStatus.revision) {
        return;
      }

      const current = statusRef.current;
      if (
        !force &&
        current &&
        current.revision === nextStatus.revision &&
        current.is_unlocked === nextStatus.is_unlocked &&
        current.session_id === nextStatus.session_id &&
        current.is_pin_blocked === nextStatus.is_pin_blocked &&
        current.pin_failed_attempts === nextStatus.pin_failed_attempts &&
        current.recovery_required === nextStatus.recovery_required &&
        current.setup_cleanup_required === nextStatus.setup_cleanup_required &&
        current.credential_store_status === nextStatus.credential_store_status &&
        current.lock_enabled === nextStatus.lock_enabled &&
        current.pin_enabled === nextStatus.pin_enabled
      ) {
        return;
      }

      const prevSessionId = sessionIdRef.current;
      const isNowLocked = !nextStatus.is_unlocked;
      const sessionChanged = prevSessionId !== nextStatus.session_id;

      if (isNowLocked || (sessionChanged && prevSessionId !== null)) {
        purgeSensitiveData();
      }

      revisionRef.current = nextStatus.revision;
      sessionIdRef.current = nextStatus.session_id;
      setStatus(nextStatus);

      if (nextStatus.is_unlocked && nextStatus.session_id) {
        void refreshAccounts();
        void refreshCodes();
      }
    },
    [purgeSensitiveData, refreshAccounts, refreshCodes],
  );

  const tryAutoUnlock = useCallback(async () => {
    if (autoUnlockPromiseRef.current) {
      return autoUnlockPromiseRef.current;
    }
    const promise = (async () => {
      try {
        const s = await api.twofaTryAutoUnlock();
        applyVaultStatus(s);
        return s.is_unlocked;
      } catch (err: unknown) {
        console.warn("Manual tryAutoUnlock error:", err);
        const parsed = parseTwofaSecurityError(err);
        if (parsed.code === "CREDENTIAL_STORE_LOCKED") {
          setStatus((prev) => (prev ? { ...prev, credential_store_status: "LockedOrDenied" } : null));
        } else if (parsed.code === "CREDENTIAL_STORE_UNAVAILABLE") {
          setStatus((prev) => (prev ? { ...prev, credential_store_status: "Unavailable" } : null));
        }
        return false;
      } finally {
        autoUnlockPromiseRef.current = null;
      }
    })();
    autoUnlockPromiseRef.current = promise;
    return promise;
  }, [applyVaultStatus]);

  const refreshStatus = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setIsLoading(false);
      return;
    }
    try {
      const s = await api.twofaGetStatus();
      applyVaultStatus(s);
      if (!s.is_unlocked && s.has_vault && !s.lock_enabled) {
        await tryAutoUnlock();
      }
    } catch (err) {
      console.error("Failed to get 2FA status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [applyVaultStatus, tryAutoUnlock]);

  // Listen to native lock/unlock events
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let mounted = true;
    const unlistenStatePromise = listen<TwofaVaultStateChangedEvent>("twofa:vault-state-changed", (event) => {
      if (!mounted) return;
      if (!event.payload.is_unlocked) {
        purgeSensitiveData();
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                is_unlocked: false,
                is_locked: true,
                session_id: null,
                revision: Math.max(prev.revision, event.payload.revision),
              }
            : null,
        );
        revisionRef.current = Math.max(revisionRef.current, event.payload.revision);
        sessionIdRef.current = null;
        void refreshStatus();
      } else {
        sessionIdRef.current = event.payload.session_id;
        revisionRef.current = Math.max(revisionRef.current, event.payload.revision);
        void refreshStatus();
      }
    });

    const unlistenAccountsPromise = listen("twofa:accounts-changed", () => {
      if (!mounted) return;
      void refreshAccounts();
      void refreshCodes();
    });

    void refreshStatus();

    return () => {
      mounted = false;
      unlistenStatePromise.then((unlisten) => unlisten());
      unlistenAccountsPromise.then((unlisten) => unlisten());
    };
  }, [purgeSensitiveData, refreshAccounts, refreshCodes, refreshStatus]);

  // When vault becomes unlocked, fetch accounts and codes
  useEffect(() => {
    if (status?.is_unlocked && status.session_id) {
      sessionIdRef.current = status.session_id;
      void refreshAccounts();
      void refreshCodes();
    }
  }, [status?.is_unlocked, status?.session_id, refreshAccounts, refreshCodes]);

  // Polling / countdown timer for OTP codes
  useEffect(() => {
    if (!status?.is_unlocked || !codesBatch) return;

    const interval = setInterval(() => {
      const localNowSecs = Math.floor(Date.now() / 1000);
      const estServerNow = localNowSecs + serverOffsetRef.current;

      let anyExpired = false;
      for (const item of codesBatch.codes) {
        if (item.valid_until <= estServerNow) {
          anyExpired = true;
          break;
        }
      }

      if (anyExpired) {
        // Reset ShowAfterClick revealed tokens on period expiry
        setRevealedAccountIds(new Set());
        void refreshCodes();
      } else {
        // Update remaining seconds in state
        setCodesBatch((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            codes: prev.codes.map((item) => ({
              ...item,
              remaining_seconds: Math.max(0, item.valid_until - estServerNow),
            })),
          };
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status?.is_unlocked, codesBatch, refreshCodes]);

  const toggleReveal = useCallback((accountId: string) => {
    setRevealedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  const unlockVault = useCallback(
    async (password: string, operationId?: string | null) => {
      try {
        const s = await api.twofaUnlockVault(password, operationId);
        applyVaultStatus(s);
        return s.is_unlocked;
      } catch (err) {
        console.error("Unlock vault error:", err);
        throw err;
      }
    },
    [applyVaultStatus],
  );

  const unlockWithPin = useCallback(
    async (pin: string, operationId?: string | null) => {
      try {
        const s = await api.twofaUnlockWithPin(pin, operationId);
        applyVaultStatus(s);
        return s.is_unlocked;
      } catch (err) {
        console.error("Unlock with PIN error:", err);
        await refreshStatus();
        throw err;
      }
    },
    [applyVaultStatus, refreshStatus],
  );

  const cleanupSetup = useCallback(async () => {
    try {
      const s = await api.twofaCleanupSetup();
      applyVaultStatus(s);
    } catch (err) {
      console.error("Cleanup setup error:", err);
      await refreshStatus();
      throw err;
    }
  }, [applyVaultStatus, refreshStatus]);

  const lockVault = useCallback(async () => {
    try {
      const s = await api.twofaLockVault();
      purgeSensitiveData();
      applyVaultStatus(s);
    } catch (err) {
      console.error("Lock vault error:", err);
    }
  }, [applyVaultStatus, purgeSensitiveData]);

  const setupVault = useCallback(
    async (
      password: string,
      lockEnabled: boolean,
      pin?: string | null,
      settings?: TwofaVaultSettings | null,
    ) => {
      try {
        const s = await api.twofaSetupVault(password, lockEnabled, pin, settings);
        applyVaultStatus(s);
        return s.is_unlocked;
      } catch (err) {
        console.error("Setup vault error:", err);
        throw err;
      }
    },
    [applyVaultStatus],
  );

  const setLockEnabled = useCallback(
    async (lockEnabled: boolean, masterPassword: string) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      const s = await api.twofaSetLockEnabled(lockEnabled, masterPassword, activeSession, activeRevision);
      applyVaultStatus(s);
      return true;
    },
    [applyVaultStatus],
  );

  const setPin = useCallback(
    async (pin: string, masterPassword: string) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      const s = await api.twofaSetPin(pin, masterPassword, activeSession, activeRevision);
      applyVaultStatus(s);
      return true;
    },
    [applyVaultStatus],
  );

  const removePin = useCallback(
    async (masterPassword: string) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      const s = await api.twofaRemovePin(masterPassword, activeSession, activeRevision);
      applyVaultStatus(s);
      return true;
    },
    [applyVaultStatus],
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      const s = await api.twofaChangePassword(oldPassword, newPassword, activeSession, activeRevision);
      applyVaultStatus(s);
      return true;
    },
    [applyVaultStatus],
  );

  const retryRecovery = useCallback(
    async (masterPassword: string) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      const s = await api.twofaRetryRecovery(masterPassword, activeSession, activeRevision);
      applyVaultStatus(s);
      return true;
    },
    [applyVaultStatus],
  );

  const updateSettings = useCallback(
    async (newSettings: TwofaVaultSettings) => {
      const activeSession = sessionIdRef.current;
      const activeRevision = revisionRef.current;
      if (!activeSession) {
        throw new Error("Vault is locked");
      }
      if (isSavingSettingsRef.current) {
        throw new Error("Cấu hình đang được lưu. Vui lòng chờ.");
      }
      isSavingSettingsRef.current = true;
      setIsSavingSettings(true);
      try {
        const updated = await api.twofaUpdateSettings(newSettings, activeSession, activeRevision);
        clearRevealedAccounts();
        applyVaultStatus(updated);
        await refreshAccounts();
        return updated;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("STALE_REVISION")) {
          await refreshStatus();
        }
        throw err;
      } finally {
        isSavingSettingsRef.current = false;
        setIsSavingSettings(false);
      }
    },
    [applyVaultStatus, clearRevealedAccounts, refreshAccounts, refreshStatus],
  );

  const copyCode = useCallback(async (accountId: string) => {
    const currentSession = sessionIdRef.current;
    if (!currentSession) {
      throw new Error("Vault is locked or session expired");
    }
    return await api.twofaCopyCode(accountId, currentSession);
  }, []);

  const codesByAccountId = useMemo(() => {
    const map: Record<string, TwofaCodeItem> = {};
    if (codesBatch?.codes) {
      for (const item of codesBatch.codes) {
        map[item.account_id] = item;
      }
    }
    return map;
  }, [codesBatch]);

  const value = useMemo<TwofaContextValue>(
    () => ({
      status,
      isUnlocked: Boolean(status?.is_unlocked),
      isInitialized: Boolean(status?.is_initialized),
      hasVault: Boolean(status?.has_vault),
      sessionId: status?.session_id ?? null,
      revision: status?.revision ?? 0,
      lockEnabled: status ? status.lock_enabled : true,
      pinEnabled: status ? status.pin_enabled : false,
      isPinBlocked: status ? status.is_pin_blocked : false,
      pinFailedAttempts: status ? status.pin_failed_attempts : 0,
      pinMaxAttempts: status ? status.pin_max_attempts : 5,
      recoveryRequired: Boolean(status?.recovery_required),
      setupCleanupRequired: Boolean(status?.setup_cleanup_required),
      credentialStoreStatus: status ? status.credential_store_status : "Untested",
      accounts,
      codesBatch,
      codesByAccountId,
      isCodesError,
      isLoading,
      isSavingSettings,
      revealedAccountIds,
      toggleReveal,
      clearRevealedAccounts,
      refreshStatus,
      refreshAccounts,
      refreshCodes,
      unlockVault,
      unlockWithPin,
      tryAutoUnlock,
      lockVault,
      cleanupSetup,
      setupVault,
      setLockEnabled,
      setPin,
      removePin,
      changePassword,
      retryRecovery,
      updateSettings,
      copyCode,
    }),
    [
      status,
      accounts,
      codesBatch,
      codesByAccountId,
      isCodesError,
      isLoading,
      isSavingSettings,
      revealedAccountIds,
      toggleReveal,
      clearRevealedAccounts,
      refreshStatus,
      refreshAccounts,
      refreshCodes,
      unlockVault,
      unlockWithPin,
      tryAutoUnlock,
      lockVault,
      cleanupSetup,
      setupVault,
      setLockEnabled,
      setPin,
      removePin,
      changePassword,
      retryRecovery,
      updateSettings,
      copyCode,
    ],
  );

  return <TwofaContext.Provider value={value}>{children}</TwofaContext.Provider>;
}

export function useTwofa() {
  const context = useContext(TwofaContext);
  if (!context) {
    throw new Error("useTwofa must be used within a TwofaProvider");
  }
  return context;
}
