import { useState } from "react";
import { Check, Copy, MoreVertical, Pencil, QrCode, Trash2 } from "lucide-react";
import {
  api,
  isDesktopRuntime,
  type HideTokenSetting,
  type Project,
  type TwofaAccountSummary,
  type TwofaCodeItem,
} from "@/lib/api";
import { formatTotpCode, getIssuerVisual, copyToClipboardWithAutoClear } from "./twofa-utils";
import { Badge } from "@/components/ui/badge";
import { useTwofa } from "./TwofaProvider";

export type TwofaTokenCardProps = {
  account: TwofaAccountSummary;
  codeItem?: TwofaCodeItem;
  projects: Project[];
  sessionId?: string | null;
  hideTokenSetting?: HideTokenSetting;
  clipboardTimeoutSecs?: number;
  onEdit: (account: TwofaAccountSummary) => void;
  onDelete: (account: TwofaAccountSummary) => void;
  onViewQr: (account: TwofaAccountSummary) => void;
  onFilterProject?: (projectId: number) => void;
};

export function TwofaTokenCard({
  account,
  codeItem,
  projects,
  sessionId,
  hideTokenSetting = "Never",
  clipboardTimeoutSecs = 30,
  onEdit,
  onDelete,
  onViewQr,
  onFilterProject,
}: TwofaTokenCardProps) {
  const { revealedAccountIds, toggleReveal } = useTwofa();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName = account.account || "";
  const visual = getIssuerVisual(account.issuer, displayName);

  const isRevealed = revealedAccountIds.has(account.id);
  const isMasked =
    hideTokenSetting === "Always" ||
    (hideTokenSetting === "ShowAfterClick" && !isRevealed);
  const maskedDots = "• ".repeat(account.digits || 6).trim();
  const formattedCode = isMasked
    ? maskedDots
    : codeItem?.code
      ? formatTotpCode(codeItem.code)
      : "• • •  • • •";

  const remaining = codeItem?.remaining_seconds ?? 0;
  const period = codeItem?.period ?? account.period ?? 30;
  const progressRatio = Math.max(0, Math.min(1, remaining / period));

  // Circular progress ring calculations
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressRatio);
  const isExpiringSoon = remaining <= 5;

  const linkedProjects = projects.filter((p) => account.project_ids.includes(p.id));

  async function handleCopy() {
    if (hideTokenSetting === "ShowAfterClick" && !isRevealed) {
      toggleReveal(account.id);
    }
    if (isDesktopRuntime()) {
      if (!sessionId) return;
      try {
        const res = await api.twofaCopyCode(account.id, sessionId);
        if (res.success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch (err) {
        console.error("Native OTP copy failed:", err);
      }
      return;
    }

    if (codeItem?.code) {
      try {
        await copyToClipboardWithAutoClear(codeItem.code, clipboardTimeoutSecs);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore clipboard write failures
      }
    }
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3.5 shadow-none transition-all duration-150 hover:border-[var(--vscode-focusBorder)]">
      {/* Top row: Avatar, Issuer, Account, Menu */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-xs font-bold tracking-tight shadow-sm"
            style={{ backgroundColor: visual.bgColor, color: visual.textColor }}
          >
            {visual.initials}
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-[var(--vscode-foreground)]" title={account.issuer || displayName}>
              {account.issuer || "2FA Account"}
            </h4>
            <p className="truncate text-xs text-muted-foreground" title={displayName}>
              {displayName || "—"}
            </p>
          </div>
        </div>

        {/* Action Menu button & dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground opacity-60 transition-opacity hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)] hover:opacity-100 group-hover:opacity-100"
            onClick={() => setMenuOpen((prev) => !prev)}
            title="Options"
            aria-label="Options"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-8 z-50 min-w-[150px] rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleCopy();
                  }}
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Copy OTP
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                  onClick={() => {
                    setMenuOpen(false);
                    onViewQr(account);
                  }}
                >
                  <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
                  Show QR Code
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(account);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  Edit Account
                </button>
                <div className="my-1 border-t border-[var(--vscode-border)]" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(account);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Code & Countdown display */}
      <div className="my-3 flex items-center justify-between rounded-[6px] bg-[var(--vscode-editor)] px-3 py-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="group/code flex cursor-pointer items-center gap-2 text-left select-all"
          title="Click to copy OTP"
        >
          <span className="font-mono text-xl font-bold tracking-wider text-[var(--vscode-foreground)] group-hover/code:text-[var(--vscode-focusBorder)]">
            {formattedCode}
          </span>
          {copied ? (
            <span className="flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">
              <Check className="h-3 w-3" /> Copied
            </span>
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100" />
          )}
        </button>

        {/* Circular Countdown Ring */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs font-mono font-medium ${
              isExpiringSoon ? "text-destructive font-bold" : "text-muted-foreground"
            }`}
          >
            {remaining}s
          </span>
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 24 24">
            {/* Background ring */}
            <circle
              cx="12"
              cy="12"
              r={radius}
              className="stroke-[var(--vscode-border)]"
              strokeWidth="2.5"
              fill="none"
            />
            {/* Animated progress ring */}
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={`transition-[stroke-dashoffset] duration-1000 linear ${
                isExpiringSoon ? "text-destructive" : "text-[var(--vscode-focusBorder)]"
              }`}
            />
          </svg>
        </div>
      </div>

      {/* Bottom row: Linked projects & details */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
        <div className="flex flex-wrap items-center gap-1">
          {linkedProjects.length > 0 ? (
            linkedProjects.map((p) => (
              <Badge
                key={p.id}
                variant="muted"
                className="cursor-pointer text-[10px] hover:border-[var(--vscode-focusBorder)]"
                onClick={() => onFilterProject?.(p.id)}
                title={`Linked to project: ${p.name}`}
              >
                {p.name}
              </Badge>
            ))
          ) : (
            <span className="text-[10.5px] italic text-muted-foreground/70">Unassigned</span>
          )}
        </div>

        {account.algorithm !== "SHA1" || account.digits !== 6 || account.period !== 30 ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {account.algorithm} • {account.digits}d • {account.period}s
          </span>
        ) : null}
      </div>
    </div>
  );
}
