import { useState, useEffect } from "react";
import { Check, Copy, Download, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, type TwofaAccountSummary } from "@/lib/api";
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
import { getIssuerVisual } from "./twofa-utils";
import { useTwofa } from "./TwofaProvider";

export type TwofaExportMode = "qr" | "plaintext" | "encrypted";

export type TwofaExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TwofaExportMode;
  account?: TwofaAccountSummary | null;
  accounts?: TwofaAccountSummary[];
};

export function TwofaExportDialog({
  open,
  onOpenChange,
  mode,
  account,
  accounts: _accounts = [],
}: TwofaExportDialogProps) {
  const { sessionId } = useTwofa();
  // QR state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [savingQrPng, setSavingQrPng] = useState(false);
  const [qrPngSaved, setQrPngSaved] = useState(false);
  const [copiedQrUri, setCopiedQrUri] = useState(false);

  // Plaintext state
  const [plaintextUris, setPlaintextUris] = useState<string[]>([]);
  const [loadingPlaintext, setLoadingPlaintext] = useState(false);
  const [savingPlaintext, setSavingPlaintext] = useState(false);
  const [copiedPlaintext, setCopiedPlaintext] = useState(false);

  // Encrypted backup state
  const [backupPassword, setBackupPassword] = useState("");
  const [confirmBackupPassword, setConfirmBackupPassword] = useState("");
  const [isExportingBackup, setIsExportingBackup] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQrDataUrl(null);
      setQrUri(null);
      setPlaintextUris([]);
      setBackupPassword("");
      setConfirmBackupPassword("");
      setError(null);
      return;
    }
    setError(null);
    setCopiedQrUri(false);
    setCopiedPlaintext(false);
    setQrPngSaved(false);
    setBackupPassword("");
    setConfirmBackupPassword("");

    if (mode === "qr" && account) {
      if (!sessionId) {
        setError("Vault session is locked or expired");
        return;
      }
      setLoadingQr(true);
      Promise.all([
        api.twofaGetAccountQr(account.id, sessionId),
        api.twofaGetAccountSecret(account.id, sessionId).catch(() => null),
      ])
        .then(([qrUrl, secretPayload]) => {
          setQrDataUrl(qrUrl);
          if (secretPayload) {
            const label =
              secretPayload.issuer && secretPayload.account
                ? `${secretPayload.issuer}:${secretPayload.account}`
                : secretPayload.issuer || secretPayload.account || "Account";
            let u = `otpauth://totp/${encodeURIComponent(label)}?secret=${secretPayload.secret}`;
            if (secretPayload.issuer) u += `&issuer=${encodeURIComponent(secretPayload.issuer)}`;
            if (secretPayload.algorithm && secretPayload.algorithm !== "SHA1") u += `&algorithm=${secretPayload.algorithm}`;
            if (secretPayload.digits && secretPayload.digits !== 6) u += `&digits=${secretPayload.digits}`;
            if (secretPayload.period && secretPayload.period !== 30) u += `&period=${secretPayload.period}`;
            setQrUri(u);
          } else {
            setQrUri(null);
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoadingQr(false));
    } else if (mode === "plaintext") {
      if (!sessionId) {
        setError("Vault session is locked or expired");
        return;
      }
      setLoadingPlaintext(true);
      api
        .twofaListAccounts(sessionId)
        .then((accounts) => {
          // Do not fetch secrets for preview; list account summary
          const lines = accounts.map(
            (acc) => `${acc.issuer || "2FA"}: ${acc.account || "Account"} (digits: ${acc.digits}, period: ${acc.period}s)`,
          );
          setPlaintextUris(lines);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoadingPlaintext(false));
    }
  }, [open, mode, account, sessionId]);

  async function handleSaveQrPng() {
    if (!account || !sessionId) return;
    setSavingQrPng(true);
    try {
      const saved = await api.twofaSaveQrPng(account.id, sessionId);
      if (saved) {
        setQrPngSaved(true);
        setTimeout(() => setQrPngSaved(false), 2500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingQrPng(false);
    }
  }

  async function handleCopyPlaintext() {
    if (plaintextUris.length === 0) return;
    try {
      await navigator.clipboard.writeText(plaintextUris.join("\n"));
      setCopiedPlaintext(true);
      setTimeout(() => setCopiedPlaintext(false), 2000);
    } catch {
      // Ignore
    }
  }

  async function handleSavePlaintextFile() {
    if (!sessionId) {
      setError("Vault session is locked or expired");
      return;
    }
    setSavingPlaintext(true);
    try {
      const saved = await api.twofaExportPlaintext(sessionId);
      if (saved) {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPlaintext(false);
    }
  }

  async function handleExportEncrypted() {
    setError(null);
    if (!sessionId) {
      setError("Vault session is locked or expired");
      return;
    }
    if (backupPassword.length < 8) {
      setError("Backup encryption password must be at least 8 characters long.");
      return;
    }
    if (backupPassword !== confirmBackupPassword) {
      setError("Backup passwords do not match.");
      return;
    }

    setIsExportingBackup(true);
    try {
      const saved = await api.twofaExportEncryptedBackup(backupPassword, sessionId);
      if (saved) {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExportingBackup(false);
    }
  }

  const visual = account ? getIssuerVisual(account.issuer, account.account) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[var(--vscode-panel)] border-[var(--vscode-border)] text-[var(--vscode-foreground)] p-5">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">
            {mode === "qr"
              ? "Account QR Code"
              : mode === "plaintext"
                ? "Export Plaintext URIs"
                : "Export Encrypted Backup (.pr2fa)"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mode === "qr"
              ? "Scan this QR code with an authenticator app to import this account."
              : mode === "plaintext"
                ? "Export all 2FA accounts as standard otpauth:// URIs."
                : "Create a password-protected backup file of your 2FA accounts."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="my-2 rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* QR Code Mode */}
        {mode === "qr" ? (
          <div className="flex flex-col items-center gap-4 py-2">
            {account && visual ? (
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] text-xs font-bold shadow-sm"
                  style={{ backgroundColor: visual.bgColor, color: visual.textColor }}
                >
                  {visual.initials}
                </div>
                <div>
                  <h4 className="text-xs font-semibold">{account.issuer}</h4>
                  <p className="text-[11px] text-muted-foreground">{account.account}</p>
                </div>
              </div>
            ) : null}

            {loadingQr ? (
              <div className="flex h-48 w-48 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-white">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
              </div>
            ) : qrDataUrl ? (
              <div className="flex h-52 w-52 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-white p-2 shadow-sm">
                <img src={qrDataUrl} alt="2FA QR Code" className="h-full w-full object-contain" />
              </div>
            ) : null}

            {qrUri ? (
              <div className="flex w-full items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={qrUri}
                  className="h-8 flex-1 rounded-[4px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] px-2.5 font-mono text-[11px] text-[var(--vscode-input-foreground)] select-all"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(qrUri);
                    setCopiedQrUri(true);
                    setTimeout(() => setCopiedQrUri(false), 2000);
                  }}
                  className="h-8"
                >
                  {copiedQrUri ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedQrUri ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={savingQrPng || !qrDataUrl}
                onClick={() => void handleSaveQrPng()}
              >
                {savingQrPng ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : qrPngSaved ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {qrPngSaved ? "Saved PNG!" : "Save QR as PNG"}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Plaintext Export Mode */}
        {mode === "plaintext" ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-start gap-2.5 rounded-[6px] border border-amber-500/30 bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <span className="font-semibold">Security Warning:</span> Plaintext exports contain raw, unencrypted 2FA secrets. Anyone with access to this file can generate codes for your accounts. Store it in a secure location and delete it immediately after use.
              </div>
            </div>

            {loadingPlaintext ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Exporting accounts...
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Found <span className="font-semibold text-[var(--vscode-foreground)]">{plaintextUris.length}</span> account URI{plaintextUris.length === 1 ? "" : "s"}.
                </p>

                <textarea
                  readOnly
                  rows={6}
                  value={plaintextUris.join("\n")}
                  className="w-full rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] p-2 font-mono text-[11px] text-[var(--vscode-input-foreground)] select-all focus:outline-none"
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyPlaintext()}
                  >
                    {copiedPlaintext ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedPlaintext ? "Copied All" : "Copy to Clipboard"}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={savingPlaintext || plaintextUris.length === 0}
                    onClick={() => void handleSavePlaintextFile()}
                  >
                    {savingPlaintext ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Save .txt File
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Encrypted Backup Mode */}
        {mode === "encrypted" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleExportEncrypted();
            }}
            className="flex flex-col gap-3 py-2"
          >
            <div className="flex items-start gap-2.5 rounded-[6px] border border-blue-500/30 bg-blue-500/10 p-3 text-blue-600 dark:text-blue-400">
              <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                Backs up all 2FA accounts and their linked project mappings encrypted with Argon2id and XChaCha20-Poly1305. You will need this password when restoring.
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-pwd" className="text-xs font-medium">
                Backup Encryption Password
              </Label>
              <Input
                id="backup-pwd"
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-confirm-pwd" className="text-xs font-medium">
                Confirm Password
              </Label>
              <Input
                id="backup-confirm-pwd"
                type="password"
                value={confirmBackupPassword}
                onChange={(e) => setConfirmBackupPassword(e.target.value)}
                className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isExportingBackup}
              >
                {isExportingBackup ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Encrypting...
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" /> Save .pr2fa Backup
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
