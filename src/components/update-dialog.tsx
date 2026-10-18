import { Download, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import type { AppUpdateInfo } from "../lib/api";
import type { UpdateStatus } from "../hooks/use-app-updater";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function UpdateDialog({
  open,
  update,
  status,
  progress,
  error,
  onOpenChange,
  onDismiss,
  onDownload,
  onInstallOrReveal,
}: {
  open: boolean;
  update: AppUpdateInfo | null;
  status: UpdateStatus;
  progress: { downloadedBytes: number; totalBytes: number } | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onDownload: () => void;
  onInstallOrReveal: () => void;
}) {
  const busy = status === "downloading" || status === "installing";
  const percent = progress?.totalBytes ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)) : 0;
  const manualInstall = update?.installAction === "install";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New update available</DialogTitle>
          <DialogDescription>
            {update ? `Version ${update.version} is ready to download.` : "Preparing update details..."}
          </DialogDescription>
        </DialogHeader>

        {status === "downloading" ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between text-[12px] text-muted-foreground"><span>Downloading update...</span><span>{percent}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--vscode-border)]"><div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
            <p className="text-[11px] text-muted-foreground">{formatBytes(progress?.downloadedBytes ?? 0)} / {formatBytes(progress?.totalBytes ?? update?.assetSize ?? 0)}</p>
          </div>
        ) : null}
        {status === "downloaded" ? <p className="py-2 text-[12px] text-muted-foreground">Update package downloaded and SHA-256 verified.</p> : null}
        {error ? <p className="rounded-[5px] border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11.5px] text-destructive">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          {status === "available" ? <Button variant="secondary" onClick={onDismiss}>Dismiss</Button> : null}
          {status === "available" ? <Button onClick={onDownload}><Download size={14} />Update</Button> : null}
          {status === "downloading" ? <Button disabled><LoaderCircle className="animate-spin" size={14} />Downloading...</Button> : null}
          {status === "downloaded" ? <Button onClick={onInstallOrReveal}>{manualInstall ? <RefreshCw size={14} /> : <FolderOpen size={14} />}{manualInstall ? "Install update now" : "Open update folder"}</Button> : null}
          {status === "installing" ? <Button disabled><LoaderCircle className="animate-spin" size={14} />Opening installer...</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
