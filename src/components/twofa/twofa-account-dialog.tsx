import { useEffect, useState } from "react";
import { Loader2, Monitor, QrCode } from "lucide-react";
import { api, type Project, type TwofaAccountInput, type TwofaAccountSecretPayload, type TwofaAccountSummary } from "@/lib/api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseOtpauthUri } from "./twofa-utils";
import { useTwofa } from "./TwofaProvider";

export type TwofaAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAccount?: TwofaAccountSummary | null;
  defaultProjectId?: number;
  projects: Project[];
  onSaved: () => void;
};

export function TwofaAccountDialog({
  open,
  onOpenChange,
  initialAccount,
  defaultProjectId,
  projects,
  onSaved,
}: TwofaAccountDialogProps) {
  const { sessionId } = useTwofa();
  const isEditing = Boolean(initialAccount);

  const [activeTab, setActiveTab] = useState<"manual" | "uri" | "screen">("manual");
  const [issuer, setIssuer] = useState("");
  const [accountName, setAccountName] = useState("");
  const [secret, setSecret] = useState("");
  const [algorithm, setAlgorithm] = useState<"SHA1" | "SHA256" | "SHA512">("SHA1");
  const [digits, setDigits] = useState<number>(6);
  const [period, setPeriod] = useState<number>(30);
  const [notes, setNotes] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);

  const [uriInput, setUriInput] = useState("");
  const [uriError, setUriError] = useState<string | null>(null);

  const [isScanningScreen, setIsScanningScreen] = useState(false);
  const [screenScanError, setScreenScanError] = useState<string | null>(null);
  const [scannedItems, setScannedItems] = useState<TwofaAccountSecretPayload[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Initialize form state
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setUriError(null);
      setScreenScanError(null);
      setUriInput("");

      if (initialAccount) {
        setIssuer(initialAccount.issuer);
        setAccountName(initialAccount.account || "");
        setSecret(""); // Leave blank to keep existing
        setAlgorithm(initialAccount.algorithm as "SHA1" | "SHA256" | "SHA512");
        setDigits(initialAccount.digits);
        setPeriod(initialAccount.period);
        setNotes(initialAccount.notes ?? "");
        setSelectedProjectIds([...initialAccount.project_ids]);
        setActiveTab("manual");
      } else {
        setIssuer("");
        setAccountName("");
        setSecret("");
        setAlgorithm("SHA1");
        setDigits(6);
        setPeriod(30);
        setNotes("");
        setSelectedProjectIds(defaultProjectId ? [defaultProjectId] : []);
        setActiveTab("manual");
      }
    } else {
      setSecret("");
      setUriInput("");
      setIssuer("");
      setAccountName("");
      setNotes("");
      setSubmitError(null);
      setUriError(null);
      setScreenScanError(null);
    }
  }, [open, initialAccount, defaultProjectId]);

  async function handleParseUri(raw: string) {
    setUriInput(raw);
    if (!raw.trim()) {
      setUriError(null);
      return;
    }
    if (!sessionId) {
      setUriError("Vault is locked or session expired");
      return;
    }
    try {
      const preview = await api.twofaPreviewImport([raw.trim()], sessionId);
      if (preview.items.length > 0) {
        const item = preview.items[0];
        setUriError(null);
        setIssuer(item.issuer);
        setAccountName(item.account);
        setAlgorithm(item.algorithm as "SHA1" | "SHA256" | "SHA512");
        setDigits(item.digits);
        setPeriod(item.period);
        if (item.notes) setNotes(item.notes);
        try {
          const u = new URL(raw.trim());
          const sec = u.searchParams.get("secret");
          if (sec) setSecret(sec);
        } catch {}
        setActiveTab("manual");
        return;
      }
    } catch (err: unknown) {
      setUriError(err instanceof Error ? err.message : String(err));
      return;
    }
    const parsed = parseOtpauthUri(raw);
    if (!parsed) {
      setUriError("Invalid otpauth:// URI. Must begin with otpauth://totp/");
      return;
    }
    setUriError(null);
    setIssuer(parsed.issuer);
    setAccountName(parsed.accountName);
    setSecret(parsed.secret);
    setAlgorithm(parsed.algorithm);
    setDigits(parsed.digits);
    setPeriod(parsed.period);
    setActiveTab("manual");
  }

  function applyScannedItem(item: TwofaAccountSecretPayload) {
    setIssuer(item.issuer);
    setAccountName(item.account);
    setSecret(item.secret);
    setAlgorithm((item.algorithm as "SHA1" | "SHA256" | "SHA512") || "SHA1");
    setDigits(item.digits || 6);
    setPeriod(item.period || 30);
    if (item.notes) setNotes(item.notes);
    setScannedItems([]);
    setActiveTab("manual");
  }

  async function handleScanScreen() {
    if (!sessionId) {
      setScreenScanError("Vault is locked or session expired");
      return;
    }
    setIsScanningScreen(true);
    setScreenScanError(null);
    setScannedItems([]);
    try {
      const res = await api.twofaScanScreenQr(sessionId);
      if (!res.items || res.items.length === 0) {
        throw new Error("No QR code detected on any screen.");
      }
      if (res.items.length === 1) {
        applyScannedItem(res.items[0]);
      } else {
        setScannedItems(res.items);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScreenScanError(msg.includes("No QR code found") ? "No QR code detected on any screen. Make sure the QR code is clearly visible on display." : msg);
    } finally {
      setIsScanningScreen(false);
    }
  }

  function toggleProject(projectId: number) {
    setSelectedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!sessionId) {
      setSubmitError("Vault is locked or session expired");
      return;
    }

    if (!issuer.trim() && !accountName.trim()) {
      setSubmitError("Please provide an issuer or account name.");
      return;
    }

    if (!isEditing && !secret.trim()) {
      setSubmitError("Secret key is required.");
      return;
    }

    const payload: TwofaAccountInput = {
      issuer: issuer.trim(),
      account: accountName.trim(),
      secret: secret.trim() ? secret.trim().replace(/\s+/g, "").toUpperCase() : null,
      algorithm,
      digits,
      period,
      notes: notes.trim() || null,
      icon: null,
      project_ids: selectedProjectIds,
    };

    setIsSubmitting(true);
    try {
      if (isEditing && initialAccount) {
        await api.twofaUpdateAccount(initialAccount.id, payload, sessionId);
      } else {
        await api.twofaCreateAccount(payload, sessionId);
      }
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg bg-[var(--vscode-panel)] border-[var(--vscode-border)] text-[var(--vscode-foreground)] p-5">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">
            {isEditing ? "Edit 2FA Account" : "Add 2FA Account"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isEditing
              ? "Update your TOTP account details and linked projects."
              : "Add a TOTP two-factor authentication account to your encrypted vault."}
          </DialogDescription>
        </DialogHeader>

        {/* Input Method Tabs (only when creating) */}
        {!isEditing ? (
          <div className="flex border-b border-[var(--vscode-border)] pt-1 text-xs">
            <button
              type="button"
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                activeTab === "manual"
                  ? "border-[var(--vscode-focusBorder)] text-[var(--vscode-foreground)]"
                  : "border-transparent text-muted-foreground hover:text-[var(--vscode-foreground)]"
              }`}
              onClick={() => setActiveTab("manual")}
            >
              Manual Details
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                activeTab === "uri"
                  ? "border-[var(--vscode-focusBorder)] text-[var(--vscode-foreground)]"
                  : "border-transparent text-muted-foreground hover:text-[var(--vscode-foreground)]"
              }`}
              onClick={() => setActiveTab("uri")}
            >
              Paste URI
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                activeTab === "screen"
                  ? "border-[var(--vscode-focusBorder)] text-[var(--vscode-foreground)]"
                  : "border-transparent text-muted-foreground hover:text-[var(--vscode-foreground)]"
              }`}
              onClick={() => setActiveTab("screen")}
            >
              <Monitor className="h-3.5 w-3.5" />
              Scan Screen QR
            </button>
          </div>
        ) : null}

        {/* Screen QR Tab Content */}
        {!isEditing && activeTab === "screen" ? (
          <div className="my-4 flex flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-[var(--vscode-border)] p-6 text-center">
            <Monitor className="h-10 w-10 text-muted-foreground/60" />
            <div>
              <p className="text-sm font-medium">Scan QR Code from Screen</p>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Display the 2FA QR code anywhere on your screen, then click the button below to capture and decode it.
              </p>
            </div>
            {screenScanError ? (
              <div className="rounded-[4px] bg-destructive/10 p-2 text-xs text-destructive">
                {screenScanError}
              </div>
            ) : null}
            {scannedItems.length > 1 ? (
              <div className="flex w-full flex-col gap-2 rounded-[6px] border border-amber-500/30 bg-amber-500/10 p-3 text-left">
                <p className="text-xs font-semibold text-amber-500">
                  Multiple QR Codes Detected ({scannedItems.length})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Select which account you would like to import:
                </p>
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pt-1">
                  {scannedItems.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyScannedItem(item)}
                      className="flex items-center justify-between rounded border border-[var(--input-border)] bg-[var(--card)] p-2 text-left hover:border-[var(--primary-color,#007acc)]"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-medium text-[var(--foreground)] truncate">
                          {item.issuer || "2FA Account"}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.account || "No account label"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-[var(--primary-color,#007acc)]">
                        Select →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Button
              type="button"
              variant="primary"
              size="default"
              disabled={isScanningScreen}
              onClick={() => void handleScanScreen()}
              className="mt-2"
            >
              {isScanningScreen ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Scanning Display...
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4" /> Scan Screen Now
                </>
              )}
            </Button>
          </div>
        ) : null}

        {/* Paste URI Tab Content */}
        {!isEditing && activeTab === "uri" ? (
          <div className="my-3 flex flex-col gap-2">
            <Label htmlFor="uri-input" className="text-xs">
              Paste otpauth:// URI
            </Label>
            <textarea
              id="uri-input"
              rows={3}
              value={uriInput}
              onChange={(e) => handleParseUri(e.target.value)}
              placeholder="otpauth://totp/GitHub:user?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
              className="w-full rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] p-2.5 font-mono text-xs text-[var(--vscode-input-foreground)] focus:border-[var(--vscode-focusBorder)] focus:outline-none"
            />
            {uriError ? (
              <p className="text-xs text-destructive">{uriError}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Pasting a valid URI automatically fills out the account details.
              </p>
            )}
          </div>
        ) : null}

        {/* Manual Form (always visible or switched to) */}
        {(activeTab === "manual" || isEditing) ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-2">
            {submitError ? (
              <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {submitError}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="issuer" className="text-xs font-medium">
                  Service / Issuer
                </Label>
                <Input
                  id="issuer"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="e.g. GitHub, Google, AWS"
                  className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="accountName" className="text-xs font-medium">
                  Account Name / Username
                </Label>
                <Input
                  id="accountName"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. user@example.com"
                  className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secret" className="text-xs font-medium">
                Secret Key (Base32) {isEditing ? <span className="text-muted-foreground font-normal">(Optional, leave blank to keep existing)</span> : null}
              </Label>
              <Input
                id="secret"
                type="text"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={isEditing ? "••••••••••••••••" : "e.g. JBSWY3DPEHPK3PXP"}
                className="h-8 font-mono text-xs tracking-wider bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
              />
            </div>

            {/* Algorithm, Digits, Period row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="algo" className="text-[11px] font-medium text-muted-foreground">
                  Algorithm
                </Label>
                <Select
                  value={algorithm}
                  onValueChange={(val) => setAlgorithm(val as "SHA1" | "SHA256" | "SHA512")}
                >
                  <SelectTrigger id="algo" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SHA1">SHA1 (Default)</SelectItem>
                    <SelectItem value="SHA256">SHA256</SelectItem>
                    <SelectItem value="SHA512">SHA512</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="digits" className="text-[11px] font-medium text-muted-foreground">
                  Digits
                </Label>
                <Select
                  value={String(digits)}
                  onValueChange={(val) => setDigits(Number.parseInt(val, 10))}
                >
                  <SelectTrigger id="digits" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 Digits</SelectItem>
                    <SelectItem value="7">7 Digits</SelectItem>
                    <SelectItem value="8">8 Digits</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="period" className="text-[11px] font-medium text-muted-foreground">
                  Period (Secs)
                </Label>
                <Input
                  id="period"
                  type="number"
                  min={5}
                  max={300}
                  value={period}
                  onChange={(e) => setPeriod(Number.parseInt(e.target.value, 10) || 30)}
                  className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes" className="text-xs font-medium">
                Notes <span className="text-muted-foreground font-normal">(Optional)</span>
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional backup recovery note, email tag, etc."
                className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
              />
            </div>

            {/* Project association checkboxes */}
            {projects.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
                <Label className="text-xs font-medium">
                  Link to Projects <span className="text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <div className="max-h-28 overflow-y-auto flex flex-col gap-1.5 pt-1">
                  {projects.map((p) => {
                    const isChecked = selectedProjectIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 text-xs text-[var(--vscode-foreground)] hover:text-[var(--vscode-focusBorder)]"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleProject(p.id)}
                          className="h-3.5 w-3.5 rounded border-[var(--vscode-border)] accent-[var(--vscode-focusBorder)]"
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Dialog Footer Actions */}
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
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...
                  </>
                ) : isEditing ? (
                  "Save Changes"
                ) : (
                  "Add Account"
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
