import { useState, useEffect } from "react";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { api, type Project, type ProjectDelete2faPreview } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ProjectDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onConfirm: (projectId: number, deleteExclusive2fa: boolean) => Promise<void>;
};

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  project,
  onConfirm,
}: ProjectDeleteDialogProps) {
  const [preview, setPreview] = useState<ProjectDelete2faPreview | null>(null);
  const [deleteMode, setDeleteMode] = useState<"keep" | "delete_exclusive">("keep");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && project) {
      setDeleteMode("keep");
      setUnlockPassword("");
      setError(null);
      setPreview(null);

      api
        .twofaPreviewProjectDeletion(project.id)
        .then((res) => setPreview(res))
        .catch(() => {
          // If 2FA preview fails (e.g. no vault), fallback to empty preview
          setPreview({
            exclusive_accounts_count: 0,
            shared_accounts_count: 0,
            is_vault_locked: false,
          });
        });
    }
  }, [open, project]);

  async function handleUnlockVault() {
    if (!unlockPassword) {
      setError("Please enter your vault password.");
      return;
    }

    setIsUnlocking(true);
    setError(null);
    try {
      await api.twofaUnlockVault(unlockPassword);
      if (project) {
        const updatedPreview = await api.twofaPreviewProjectDeletion(project.id);
        setPreview(updatedPreview);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUnlocking(false);
    }
  }

  async function handleDelete() {
    if (!project) return;
    setError(null);

    // If user chose to delete exclusive 2FA accounts but vault is locked, require unlocking first
    if (deleteMode === "delete_exclusive" && preview?.is_vault_locked) {
      setError("Please unlock your 2FA vault first to delete exclusive accounts.");
      return;
    }

    setIsDeleting(true);
    try {
      await onConfirm(project.id, deleteMode === "delete_exclusive");
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }

  if (!project) return null;

  const exclusiveCount = preview?.exclusive_accounts_count ?? 0;
  const sharedCount = preview?.shared_accounts_count ?? 0;
  const total2fa = exclusiveCount + sharedCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[var(--vscode-panel)] border-[var(--vscode-border)] text-[var(--vscode-foreground)] p-5">
        <DialogHeader className="gap-1">
          <div className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold">Delete Project</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Are you sure you want to delete project <strong className="text-[var(--vscode-foreground)]">{project.name}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="my-2 rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* 2FA Accounts Handling Options */}
        {total2fa > 0 ? (
          <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-3.5 my-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--vscode-foreground)]">2FA Accounts Linked:</span>
              <span className="text-muted-foreground">
                {exclusiveCount} exclusive, {sharedCount} shared
              </span>
            </div>

            <div className="flex flex-col gap-2.5 pt-1 text-xs">
              {/* Option 1: Keep 2FA accounts (Default) */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="delete-2fa-policy"
                  checked={deleteMode === "keep"}
                  onChange={() => setDeleteMode("keep")}
                  className="mt-0.5 accent-[var(--vscode-focusBorder)]"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-[var(--vscode-foreground)]">
                    Keep 2FA accounts, only unlink (Default)
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    All 2FA accounts remain in your vault. Exclusive accounts will become Unassigned.
                  </span>
                </div>
              </label>

              {/* Option 2: Delete exclusive accounts */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="delete-2fa-policy"
                  checked={deleteMode === "delete_exclusive"}
                  onChange={() => setDeleteMode("delete_exclusive")}
                  className="mt-0.5 accent-[var(--vscode-focusBorder)]"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-destructive">
                    Also delete {exclusiveCount} account(s) exclusive to this project
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Accounts linked to other projects will always be kept.
                  </span>
                </div>
              </label>
            </div>

            {/* Prompt for vault unlock if delete_exclusive is selected and vault is locked */}
            {deleteMode === "delete_exclusive" && preview?.is_vault_locked ? (
              <div className="mt-2 flex flex-col gap-2 rounded-[4px] border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
                <div className="flex items-center gap-1.5 text-amber-500 font-medium">
                  <Lock className="h-3.5 w-3.5" /> Vault is locked
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Unlocking is required to safely remove exclusive accounts from the encrypted vault.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="password"
                    placeholder="Vault password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    className="h-7 text-xs bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)]"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isUnlocking}
                    onClick={() => void handleUnlockVault()}
                    className="h-7 shrink-0"
                  >
                    {isUnlocking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Unlock"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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
            type="button"
            variant="danger"
            size="sm"
            disabled={
              isDeleting ||
              (deleteMode === "delete_exclusive" && Boolean(preview?.is_vault_locked))
            }
            onClick={() => void handleDelete()}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting...
              </>
            ) : (
              "Delete Project"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
