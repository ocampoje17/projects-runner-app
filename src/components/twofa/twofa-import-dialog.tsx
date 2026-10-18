import { useState, useEffect } from "react";
import { AlertCircle, FileUp, Loader2, Monitor, QrCode } from "lucide-react";
import {
  api,
  type CommitImportItemSelection,
  type ImportAction,
  type Project,
  type TwofaImportPreview,
} from "@/lib/api";
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
import { useTwofa } from "./TwofaProvider";

export type TwofaImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: number;
  projects?: Project[];
  onImported?: () => void;
};

interface ItemFormState {
  selected: boolean;
  action: ImportAction;
  issuer: string;
  account: string;
  secret: string | null;
  projectIds: number[];
}

export function TwofaImportDialog({
  open,
  onOpenChange,
  defaultProjectId,
  projects = [],
  onImported,
}: TwofaImportDialogProps) {
  const { sessionId } = useTwofa();
  const [step, setStep] = useState<"input" | "preview">("input");
  const [importType, setImportType] = useState<"plaintext" | "encrypted">("plaintext");

  // Plaintext input
  const [rawText, setRawText] = useState("");

  // Encrypted backup input
  const [backupFileContent, setBackupFileContent] = useState<string | null>(null);
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [backupPassword, setBackupPassword] = useState("");

  // Preview state
  const [preview, setPreview] = useState<TwofaImportPreview | null>(null);
  const [itemForms, setItemForms] = useState<Record<string, ItemFormState>>({});
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("input");
      setImportType("plaintext");
      setRawText("");
      setBackupFileContent(null);
      setBackupFileName(null);
      setBackupPassword("");
      setPreview(null);
      setItemForms({});
      setSelectedProjectIds(defaultProjectId ? [defaultProjectId] : []);
      setError(null);
    }
  }, [open, defaultProjectId]);

  useEffect(() => {
    if (!sessionId && open) {
      if (preview) {
        setPreview(null);
      }
      setStep("input");
      onOpenChange(false);
    }
  }, [sessionId, open, preview, onOpenChange]);

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && preview && sessionId) {
      void api.twofaCancelImportPreview(preview.preview_id, sessionId).catch(() => {});
    }
    onOpenChange(nextOpen);
  }

  function handleBackToInput() {
    if (preview && sessionId) {
      void api.twofaCancelImportPreview(preview.preview_id, sessionId).catch(() => {});
    }
    setPreview(null);
    setStep("input");
  }

  function initPreview(previewResult: TwofaImportPreview) {
    const initialForms: Record<string, ItemFormState> = {};
    for (const item of previewResult.items) {
      const rowProjectIds: number[] = [];
      if (item.suggested_project_names && item.suggested_project_names.length > 0) {
        for (const name of item.suggested_project_names) {
          const match = projects.find(
            (p) => p.name.toLowerCase() === name.toLowerCase(),
          );
          if (match && !rowProjectIds.includes(match.id)) {
            rowProjectIds.push(match.id);
          }
        }
      }
      if (rowProjectIds.length === 0 && defaultProjectId) {
        rowProjectIds.push(defaultProjectId);
      }

      initialForms[item.temp_id] = {
        selected: item.is_valid,
        action: item.is_duplicate ? "skip" : "create",
        issuer: item.issuer,
        account: item.account,
        secret: null,
        projectIds: rowProjectIds,
      };
    }
    setPreview(previewResult);
    setItemForms(initialForms);
    setStep("preview");
  }

  // Handle file select for both plaintext .txt and .pr2fa
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const text = await file.text();

    if (file.name.endsWith(".pr2fa") || text.trim().startsWith("{")) {
      setImportType("encrypted");
      setBackupFileName(file.name);
      setBackupFileContent(text);
    } else {
      setImportType("plaintext");
      setRawText(text);
    }
  }

  async function handleProceedToPreview() {
    setError(null);
    if (!sessionId) {
      setError("Vault is locked or session expired.");
      return;
    }
    setIsLoading(true);

    try {
      if (importType === "plaintext") {
        const uris = rawText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.toLowerCase().startsWith("otpauth://"));

        if (uris.length === 0) {
          throw new Error("No valid otpauth:// URIs found in input.");
        }

        const previewResult = await api.twofaPreviewImport(uris, sessionId);
        if (previewResult.items.length === 0) {
          throw new Error("Could not parse any valid 2FA TOTP accounts.");
        }
        initPreview(previewResult);
      } else {
        // Encrypted backup
        if (!backupFileContent) {
          throw new Error("Please select a .pr2fa backup file.");
        }
        if (!backupPassword) {
          throw new Error("Please enter the backup decryption password.");
        }

        const previewResult = await api.twofaImportEncryptedBackup(
          backupFileContent,
          backupPassword,
          sessionId,
        );

        initPreview(previewResult);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleScanScreenQr() {
    if (!sessionId) {
      setError("Vault is locked or session expired.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const previewResult = await api.twofaPreviewImportFromScreen(sessionId);
      if (!previewResult.items || previewResult.items.length === 0) {
        throw new Error("No TOTP QR code detected on any visible monitor.");
      }
      initPreview(previewResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePickImageQr() {
    if (!sessionId) {
      setError("Vault is locked or session expired.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const previewResult = await api.twofaPreviewImportFromImageDialog(sessionId);
      if (!previewResult.items || previewResult.items.length === 0) {
        return;
      }
      initPreview(previewResult);
    } catch (err: unknown) {
      if (String(err).includes("NO_FILE_SELECTED")) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCommitImport() {
    if (!preview || !sessionId) return;

    setError(null);
    setIsLoading(true);

    try {
      const selections: CommitImportItemSelection[] = preview.items.map((item) => {
        const form = itemForms[item.temp_id];
        return {
          temp_id: item.temp_id,
          selected: form ? form.selected : true,
          action: form ? form.action : item.is_duplicate ? "skip" : "create",
          issuer: form ? form.issuer : item.issuer,
          account: form ? form.account : item.account,
          secret: form ? form.secret : null,
          algorithm: item.algorithm,
          digits: item.digits,
          period: item.period,
          project_ids: form ? form.projectIds : selectedProjectIds,
        };
      });

      await api.twofaImportAccounts(preview.preview_id, selections, sessionId);
      onImported?.();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  const duplicatesCount = preview?.items.filter((i) => i.is_duplicate).length ?? 0;
  const newCount = (preview?.items.length ?? 0) - duplicatesCount;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md sm:max-w-xl bg-[var(--vscode-panel)] border-[var(--vscode-border)] text-[var(--vscode-foreground)] p-5">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">
            {step === "input" ? "Import 2FA Accounts" : "Import Preview & Conflicts"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "input"
              ? "Import accounts from QR scan, otpauth:// URIs, or an encrypted .pr2fa backup."
              : `Review ${preview?.items?.length ?? 0} accounts found before adding to your vault.`}
          </DialogDescription>
        </DialogHeader>

        {preview?.partial_warning && (
          <div className="flex items-center gap-2 rounded-[6px] bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-500">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{preview.partial_warning}</span>
          </div>
        )}

        {error ? (
          <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {step === "input" ? (
          <div className="flex flex-col gap-4 py-2">
            {/* Quick QR scanning options */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => void handleScanScreenQr()}
                className="flex-1 py-2 text-xs"
              >
                <Monitor className="h-3.5 w-3.5 text-muted-foreground" /> Scan Screen QR
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => void handlePickImageQr()}
                className="flex-1 py-2 text-xs"
              >
                <QrCode className="h-3.5 w-3.5 text-muted-foreground" /> Scan QR Image File
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-[var(--vscode-border)]" />
              <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
                Or choose file / text
              </span>
              <div className="h-px flex-1 bg-[var(--vscode-border)]" />
            </div>

            {/* Format toggle */}
            <div className="flex rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-1 text-xs">
              <button
                type="button"
                className={`flex-1 rounded-[4px] py-1.5 font-medium transition-colors ${
                  importType === "plaintext"
                    ? "bg-[var(--vscode-panel)] text-[var(--vscode-foreground)] shadow-sm"
                    : "text-muted-foreground hover:text-[var(--vscode-foreground)]"
                }`}
                onClick={() => setImportType("plaintext")}
              >
                URI List (.txt / pasted)
              </button>
              <button
                type="button"
                className={`flex-1 rounded-[4px] py-1.5 font-medium transition-colors ${
                  importType === "encrypted"
                    ? "bg-[var(--vscode-panel)] text-[var(--vscode-foreground)] shadow-sm"
                    : "text-muted-foreground hover:text-[var(--vscode-foreground)]"
                }`}
                onClick={() => setImportType("encrypted")}
              >
                Encrypted Backup (.pr2fa)
              </button>
            </div>

            {/* File chooser button */}
            <div className="flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[6px] border border-dashed border-[var(--vscode-border)] py-3 text-xs text-muted-foreground hover:border-[var(--vscode-focusBorder)] hover:text-[var(--vscode-foreground)]">
                <FileUp className="h-4 w-4" />
                <span>
                  {backupFileName
                    ? `Selected: ${backupFileName}`
                    : "Click to select a file (.txt or .pr2fa)"}
                </span>
                <input
                  type="file"
                  accept=".txt,.pr2fa,.json"
                  className="hidden"
                  onChange={(e) => void handleFileSelect(e)}
                />
              </label>
            </div>

            {importType === "plaintext" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="raw-text" className="text-xs font-medium">
                  Or paste otpauth:// URIs (one per line)
                </Label>
                <textarea
                  id="raw-text"
                  rows={4}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={
                    "otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP\notpauth://totp/Google:alice@gmail.com?secret=HXDMVJECJJWXZ"
                  }
                  className="w-full rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] p-2.5 font-mono text-xs text-[var(--vscode-input-foreground)] focus:border-[var(--vscode-focusBorder)] focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="backup-pwd" className="text-xs font-medium">
                  Backup Password
                </Label>
                <Input
                  id="backup-pwd"
                  type="password"
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(e.target.value)}
                  placeholder="Enter the password used when backing up"
                  className="h-8 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                />
              </div>
            )}

            {/* Target project attachment */}
            {projects.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
                <Label className="text-xs font-medium">
                  Attach imported accounts to project
                </Label>
                <div className="max-h-24 overflow-y-auto flex flex-col gap-1 pt-0.5">
                  {projects.map((p) => {
                    const isChecked = selectedProjectIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 text-xs text-[var(--vscode-foreground)]"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            setSelectedProjectIds((current) =>
                              current.includes(p.id)
                                ? current.filter((id) => id !== p.id)
                                : [...current, p.id],
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-[var(--vscode-border)] accent-[var(--vscode-focusBorder)]"
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isLoading}
                onClick={() => void handleProceedToPreview()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing...
                  </>
                ) : (
                  "Preview Import"
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Preview Step */
          <div className="flex flex-col gap-3.5 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                <strong className="text-[var(--vscode-foreground)]">{newCount}</strong> new account
                {newCount === 1 ? "" : "s"}
                {duplicatesCount > 0 ? (
                  <>
                    ,{" "}
                    <strong className="text-amber-500">{duplicatesCount}</strong> existing conflict
                    {duplicatesCount === 1 ? "" : "s"}
                  </>
                ) : null}
              </span>

              {duplicatesCount > 0 ? (
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">For conflicts:</span>
                  <button
                    type="button"
                    className="underline text-[var(--vscode-focusBorder)] hover:opacity-80"
                    onClick={() => {
                      setItemForms((prev) => {
                        const next = { ...prev };
                        preview?.items.forEach((item) => {
                          if (item.is_duplicate && next[item.temp_id]) {
                            next[item.temp_id] = { ...next[item.temp_id], action: "skip" };
                          }
                        });
                        return next;
                      });
                    }}
                  >
                    Skip All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    className="underline text-[var(--vscode-focusBorder)] hover:opacity-80"
                    onClick={() => {
                      setItemForms((prev) => {
                        const next = { ...prev };
                        preview?.items.forEach((item) => {
                          if (item.is_duplicate && next[item.temp_id]) {
                            next[item.temp_id] = { ...next[item.temp_id], action: "link" };
                          }
                        });
                        return next;
                      });
                    }}
                  >
                    Link Project
                  </button>
                </div>
              ) : null}
            </div>

            {/* List of accounts preview */}
            <div className="max-h-60 overflow-y-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] divide-y divide-[var(--vscode-border)]">
              {preview?.items.map((item) => {
                const form = itemForms[item.temp_id] ?? {
                  selected: true,
                  action: item.is_duplicate ? "skip" : "create",
                  issuer: item.issuer,
                  account: item.account,
                  secret: null,
                  projectIds: defaultProjectId ? [defaultProjectId] : [],
                };
                return (
                  <div
                    key={item.temp_id}
                    className={`flex flex-col gap-2 p-2.5 text-xs ${
                      !item.is_valid ? "bg-red-500/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={form.selected}
                          onChange={(e) =>
                            setItemForms((prev) => ({
                              ...prev,
                              [item.temp_id]: { ...form, selected: e.target.checked },
                            }))
                          }
                          className="h-3.5 w-3.5 shrink-0 rounded border-[var(--input-border)] accent-[var(--primary-color,#007acc)]"
                        />
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            value={form.issuer}
                            onChange={(e) =>
                              setItemForms((prev) => ({
                                ...prev,
                                [item.temp_id]: { ...form, issuer: e.target.value },
                              }))
                            }
                            placeholder="Issuer"
                            className="h-6 w-28 rounded border border-[var(--input-border)] bg-[var(--bg-input,#1f1f1f)] px-1.5 text-xs text-[var(--foreground)]"
                          />
                          <input
                            type="text"
                            value={form.account}
                            onChange={(e) =>
                              setItemForms((prev) => ({
                                ...prev,
                                [item.temp_id]: { ...form, account: e.target.value },
                              }))
                            }
                            placeholder="Account"
                            className="h-6 flex-1 min-w-0 rounded border border-[var(--input-border)] bg-[var(--bg-input,#1f1f1f)] px-1.5 text-xs text-[var(--foreground)]"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {item.is_duplicate ? (
                          <div className="flex items-center gap-1 rounded bg-[var(--card)] px-1.5 py-0.5 text-[10.5px]">
                            <span className="text-amber-500 font-medium">Duplicate</span>
                            <Select
                              value={form.action}
                              onValueChange={(val) =>
                                setItemForms((prev) => ({
                                  ...prev,
                                  [item.temp_id]: {
                                    ...form,
                                    action: val as ImportAction,
                                  },
                                }))
                              }
                            >
                              <SelectTrigger className="h-6 w-24 text-[11px] px-1.5 py-0 border-none bg-transparent">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Skip</SelectItem>
                                <SelectItem value="link">Link to project</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-500">
                            New
                          </span>
                        )}
                      </div>
                    </div>

                    {projects.length > 0 && (form.action === "link" || !item.is_duplicate) && (
                      <div className="flex items-center gap-2 pl-5 text-[11px] text-muted-foreground">
                        <span>Project:</span>
                        <Select
                          value={
                            form.projectIds[0] !== undefined
                              ? String(form.projectIds[0])
                              : "unassigned"
                          }
                          onValueChange={(val) => {
                            const parsed = val === "unassigned" ? null : Number.parseInt(val, 10);
                            setItemForms((prev) => ({
                              ...prev,
                              [item.temp_id]: {
                                ...form,
                                projectIds: parsed !== null ? [parsed] : [],
                              },
                            }));
                          }}
                        >
                          <SelectTrigger className="h-6 text-[11px] px-2 py-0 max-w-[200px]">
                            <SelectValue placeholder="No Project (Unassigned)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">No Project (Unassigned)</SelectItem>
                            {projects.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {!item.is_valid && (
                      <div className="text-[11px] text-red-400">
                        Validation error: {item.validation_error ?? "Invalid configuration"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleBackToInput}
                className="text-xs text-[var(--vscode-focusBorder)] hover:underline"
              >
                ← Back to Input
              </button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleClose(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => void handleCommitImport()}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing...
                    </>
                  ) : (
                    "Confirm Import"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
