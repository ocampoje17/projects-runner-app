import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import { Button } from "./ui/button";
import { StatefulButton } from "./ui/stateful-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogField, DialogFooter, DialogForm } from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function FlowFormDialog({
  mode = "create",
  open,
  projectName,
  flowName,
  isPending,
  error,
  onOpenChange,
  onSubmit,
}: {
  mode?: "create" | "edit";
  open: boolean;
  projectName: string | null;
  flowName?: string;
  isPending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(flowName ?? "Development stack");

  useEffect(() => {
    if (open) setName(flowName ?? "Development stack");
  }, [flowName, open]);

  const trimmedName = name.trim();
  const isEditing = mode === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit flow" : "Add flow"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update the flow information for ${projectName ?? "this project"}.`
              : `Create a reusable sequence of commands for ${projectName ?? "this project"}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogForm onSubmit={(event) => { event.preventDefault(); if (trimmedName) onSubmit(trimmedName); }}>
          <DialogField>
            <Label htmlFor="flow-name">Flow name</Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Development stack"
              autoFocus
              disabled={isPending}
            />
            {error ? <p className="text-[12px] font-medium text-destructive">{error}</p> : null}
          </DialogField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
            <StatefulButton type="submit" state={isPending ? "loading" : "idle"} icon={<Save size={16} />} disabled={!trimmedName} loadingText={isEditing ? "Saving" : "Creating"}>
              {isEditing ? "Save changes" : "Create flow"}
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
