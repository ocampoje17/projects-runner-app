import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { isDesktopRuntime, type TwofaAccountSummary } from "@/lib/api";
import { useTwofa } from "./TwofaProvider";
import { TwofaLockDialog, type TwofaLockDialogMode } from "./twofa-lock-dialog";
import { copyToClipboardWithAutoClear, formatTotpCode, sortTwofaAccounts } from "./twofa-utils";
import { Button } from "../ui/button";

export function FilesTwofaPanel({ projectId, onError }: { projectId: number; onError: (message: string) => void }) {
  const { status, isLoading, isUnlocked, accounts, codesByAccountId, isCodesError, refreshStatus, refreshCodes, copyCode, revealedAccountIds, toggleReveal, sessionId } = useTwofa();
  const [dialogMode, setDialogMode] = useState<TwofaLockDialogMode | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCopy = useRef(false);
  const contextRef = useRef({ projectId, sessionId, isUnlocked });
  contextRef.current = { projectId, sessionId, isUnlocked };
  const projectAccounts = useMemo(() => sortTwofaAccounts(accounts.filter((account) => account.project_ids.includes(projectId)), status?.sort_order_setting ?? "ISSUER_ASC"), [accounts, projectId, status?.sort_order_setting]);

  useEffect(() => {
    contextRef.current = { projectId, sessionId, isUnlocked };
    setCopiedId(null);
    setCopyingId(null);
    return () => {
      contextRef.current = { projectId: -1, sessionId: null, isUnlocked: false };
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [projectId, sessionId, isUnlocked]);

  async function handleCopy(account: TwofaAccountSummary) {
    if (pendingCopy.current || !isUnlocked) return;
    pendingCopy.current = true;
    setCopyingId(account.id);
    const startingSession = sessionId;
    const isCurrent = () => contextRef.current.projectId === projectId && contextRef.current.sessionId === startingSession && contextRef.current.isUnlocked;
    try {
      if (isDesktopRuntime()) {
        const result = await copyCode(account.id);
        if (!result.success) throw new Error("Unable to copy 2FA code.");
      } else {
        const code = codesByAccountId[account.id];
        if (!code?.is_valid || code.remaining_seconds <= 0) throw new Error("2FA code is unavailable. Try again.");
        const timeout = { Disabled: 0, TenSeconds: 10, TwentySeconds: 20, ThirtySeconds: 30, OneMinute: 60 }[status?.clear_clipboard_setting ?? "ThirtySeconds"];
        await copyToClipboardWithAutoClear(code.code, timeout);
      }
      if (!isCurrent()) return;
      if (status?.hide_token_setting === "ShowAfterClick" && !revealedAccountIds.has(account.id)) toggleReveal(account.id);
      setCopiedId(account.id);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      if (isCurrent()) onError(error instanceof Error ? error.message : "Unable to copy 2FA code.");
    } finally {
      pendingCopy.current = false;
      if (isCurrent()) setCopyingId(null);
    }
  }

  const needsSetup = !status?.has_vault;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground"><LoaderCircle size={12} className="animate-spin" />Loading…</div>
          : !status ? <Button size="sm" variant="ghost" onClick={() => void refreshStatus()}>Retry vault</Button>
          : !isUnlocked ? <Button size="sm" variant="ghost" onClick={() => setDialogMode(status.recovery_required ? "retry-recovery" : needsSetup ? "setup" : "unlock")}><LockKeyhole size={13} />{needsSetup ? "Set up vault" : "Unlock vault"}</Button>
          : projectAccounts.length === 0 ? <div className="px-1 py-2 text-[11px] text-muted-foreground">No linked 2FA accounts.</div>
          : <>
            {isCodesError ? <Button size="sm" variant="ghost" onClick={() => void refreshCodes()}>Retry codes</Button> : null}
            {projectAccounts.map((account) => {
              const code = codesByAccountId[account.id];
              const available = account.is_valid && code?.is_valid && code.remaining_seconds > 0;
              const masked = status.hide_token_setting === "Always" || (status.hide_token_setting === "ShowAfterClick" && !revealedAccountIds.has(account.id));
              const displayCode = !available || masked ? "•".repeat(account.digits || 6) : formatTotpCode(code.code);
              const copied = copiedId === account.id;
              return (
                <button key={account.id} type="button" disabled={!available || copyingId !== null} onClick={() => void handleCopy(account)}
                  aria-label={`Copy 2FA code for ${account.issuer || account.account}${account.issuer && account.account ? ` (${account.account})` : ""}`}
                  title={account.validation_error || code?.error || `${account.issuer} ${account.account}`.trim()}
                  className="group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[4px] px-1.5 py-1 text-left text-[12px] text-[var(--vscode-foreground)]/80 hover:bg-[var(--vscode-list-hover)] hover:text-foreground disabled:opacity-50 app-focus-ring">
                  <KeyRound size={13} className="shrink-0 text-[var(--vscode-icon)]" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{account.issuer || account.account || "2FA"}</span>
                    {account.issuer && account.account ? <span className="truncate text-[10px] text-muted-foreground">{account.account}</span> : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="whitespace-nowrap font-mono text-[12px] tabular-nums">{displayCode}</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className={available && code.remaining_seconds <= 5 ? "text-[var(--vscode-danger)]" : ""}>{available ? `${code.remaining_seconds}s` : "—"}</span>
                      {copied ? <Check size={11} aria-label="Copied" className="text-success" /> : copyingId === account.id ? <LoaderCircle size={11} className="animate-spin" aria-hidden /> : <Copy size={11} className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
                    </span>
                  </span>
                </button>
              );
            })}
          </>}
      </div>
      {dialogMode ? <TwofaLockDialog open onOpenChange={(open) => { if (!open) setDialogMode(null); }} mode={dialogMode} /> : null}
    </>
  );
}
