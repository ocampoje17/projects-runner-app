import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogField, DialogFooter, DialogForm } from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { StatefulButton } from "./ui/stateful-button";

export function CommandSectionDialog({
  open,
  projectName,
  isPending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  projectName: string | null;
  isPending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const trimmedName = name.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>Add command section</DialogTitle>
          <DialogDescription>
            Group related commands for {projectName ?? "this project"}.
          </DialogDescription>
        </DialogHeader>
        <DialogForm
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmedName) onSubmit(trimmedName);
          }}
        >
          <DialogField>
            <Label htmlFor="command-section-name">Section name</Label>
            <Input
              id="command-section-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Development"
              autoFocus
              disabled={isPending}
            />
            {error ? <p className="text-[12px] font-medium text-destructive">{error}</p> : null}
          </DialogField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <StatefulButton
              type="submit"
              state={isPending ? "loading" : "idle"}
              icon={<Plus size={16} />}
              disabled={!trimmedName}
              loadingText="Creating"
            >
              Add section
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
