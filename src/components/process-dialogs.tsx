import { Check } from "lucide-react";

import { useEffect, useState } from "react";
import type { PortProcess, ProjectCommand } from "../lib/api";
import { commandPorts } from "../lib/command-utils";
import { Button } from "./ui/button"
import { StatefulButton } from "./ui/stateful-button";
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
      <DialogContent className="w-[min(420px,calc(100vw-20px))]">
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
      <DialogContent className="w-[min(540px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>Kill ports for "{command.name}"</DialogTitle>
          <DialogDescription>Scan results for ports: {ports.map((port) => `:${port}`).join(", ")}</DialogDescription>
        </DialogHeader>

        <div className="my-3 flex min-h-[110px] flex-col">
          {processes.length === 0 ? (
            <div className="no-processes-state flex flex-col items-center justify-center gap-3 rounded-[8px] border border-dashed border-app-border bg-input px-4 py-8 text-center text-muted-foreground">
              <Check className="text-app-success animate-bounce-subtle" size={24} />
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
                      className={`group flex items-center gap-2.5 rounded-[8px] border border-app-border bg-card px-2.5 py-2 transition-colors ${isChecked ? "border-primary bg-primary/5" : "hover:border-primary hover:bg-muted"}`}
                      onClick={() => !isKilling && toggleSelectPid(process.pid)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleSelectPid(process.pid)}
                        disabled={isKilling}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13px] font-semibold text-foreground">{process.name}</span>
                        <span className="mt-0.5 text-[11.5px] text-muted-foreground">
                          PID: <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">{process.pid}</code> | Port: <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">:{process.port}</code>
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
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
            <StatefulButton
              type="button"
              variant="danger"
              disabled={selectedPids.size === 0}
              state={isKilling ? "loading" : "idle"}
              loadingText="Killing..."
              onClick={() => onKill(Array.from(selectedPids))}
            >
              {`Kill Selected (${selectedPids.size})`}
            </StatefulButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}




