import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PortProcess, ProjectCommand } from "../lib/api";
import { commandPorts } from "../lib/command-utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { DialogFooter } from "./ui/dialog-form";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  isDestructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isDestructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirm-dialog compact-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? "danger" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KillPortsDialog({
  open,
  onOpenChange,
  command,
  processes,
  onKill,
  isKilling,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  command: ProjectCommand | null;
  processes: PortProcess[];
  onKill: (pids: number[]) => void;
  isKilling: boolean;
  onRefresh: () => void;
}) {
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelectedPids(new Set(processes.map((process) => process.pid)));
  }, [processes]);

  if (!command) {
    return null;
  }

  const toggleSelectAll = () => {
    if (selectedPids.size === processes.length) {
      setSelectedPids(new Set());
      return;
    }

    setSelectedPids(new Set(processes.map((process) => process.pid)));
  };

  const toggleSelectPid = (pid: number) => {
    setSelectedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  };

  const ports = commandPorts(command);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kill-ports-dialog wide-dialog">
        <DialogHeader>
          <DialogTitle>Kill ports for "{command.name}"</DialogTitle>
          <DialogDescription>Scan results for ports: {ports.map((port) => `:${port}`).join(", ")}</DialogDescription>
        </DialogHeader>

        <div className="kill-ports-content">
          {processes.length === 0 ? (
            <div className="no-processes-state flex flex-col items-center justify-center gap-3 rounded-[8px] border border-dashed border-app-border bg-input px-4 py-8 text-center text-muted-foreground">
              <Check className="success-icon animate-bounce-subtle" size={24} />
              <p>No active processes found using these ports.</p>
            </div>
          ) : (
            <div className="processes-list-wrapper flex flex-col gap-2">
              <div className="processes-list-header flex items-center justify-between px-1">
                <label className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <Checkbox
                    checked={selectedPids.size === processes.length && processes.length > 0}
                    onCheckedChange={toggleSelectAll}
                    disabled={isKilling}
                  />
                  <span className="checkbox-label">Select All ({processes.length})</span>
                </label>
                <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isKilling} type="button">
                  Refresh
                </Button>
              </div>

              <div className="processes-list flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-1">
                {processes.map((process) => {
                  const isChecked = selectedPids.has(process.pid);
                  return (
                    <div
                      key={`${process.pid}-${process.port}`}
                      className={`process-item-row flex items-center gap-2.5 rounded-[8px] border border-app-border bg-card px-2.5 py-2 transition-colors ${isChecked ? "selected border-primary bg-primary/5" : "hover:border-primary hover:bg-muted"}`}
                      onClick={() => !isKilling && toggleSelectPid(process.pid)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleSelectPid(process.pid)}
                        disabled={isKilling}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <div className="process-details">
                        <span className="process-name">{process.name}</span>
                        <span className="process-meta">
                          PID: <code>{process.pid}</code> | Port: <code>:{process.port}</code>
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        className="single-kill-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onKill([process.pid]);
                        }}
                        disabled={isKilling}
                      >
                        Kill
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isKilling}>
            Close
          </Button>
          {processes.length > 0 && (
            <Button
              type="button"
              variant="danger"
              disabled={selectedPids.size === 0 || isKilling}
              onClick={() => onKill(Array.from(selectedPids))}
            >
              {isKilling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Killing...
                </>
              ) : (
                `Kill Selected (${selectedPids.size})`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

