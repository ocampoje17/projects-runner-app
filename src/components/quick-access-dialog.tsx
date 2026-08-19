import { useEffect, useState } from "react";
import { Pin } from "lucide-react";
import { api, type Project } from "../lib/api";
import { normalizeProjectRelativePath } from "../lib/file-tree-paths";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogErrorText, DialogField, DialogFooter, DialogForm } from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { StatefulButton } from "./ui/stateful-button";

export type QuickAccessEntry = {
  projectId: number;
  relativePath: string;
  name: string;
  isDirectory: boolean;
};

export function QuickAccessAddDialog({
  open,
  project,
  existingPaths,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  project: Project;
  existingPaths: Set<string>;
  onOpenChange: (open: boolean) => void;
  onAdd: (entry: QuickAccessEntry) => void;
}) {
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open) {
      setPathInput("");
      setError(null);
      setIsPending(false);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rawInput = pathInput.trim();
    if (!rawInput) {
      setError("Please enter a file or folder path.");
      return;
    }

    const normalizedPath = normalizeProjectRelativePath(rawInput, project.path);
    if (!normalizedPath) {
      setError("Please enter a valid file or folder path within the project.");
      return;
    }

    if (existingPaths.has(normalizedPath)) {
      setError("This item is already pinned in Quick Access.");
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const fileInfo = await api.getProjectFileInfo(project.id, normalizedPath);
      const relativePath = fileInfo.relative_path || normalizedPath;
      if (existingPaths.has(relativePath)) {
        setError("This item is already pinned in Quick Access.");
        setIsPending(false);
        return;
      }

      onAdd({
        projectId: project.id,
        relativePath,
        name: fileInfo.name || relativePath.split("/").pop() || relativePath,
        isDirectory: fileInfo.is_directory,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "File or folder not found in this project.";
      setError(message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>Pin to Quick Access</DialogTitle>
          <DialogDescription>
            Enter a relative or full path to a file or folder in {project.name}.
          </DialogDescription>
        </DialogHeader>
        <DialogForm onSubmit={handleSubmit}>
          <DialogField>
            <Label htmlFor="quick-access-path">File or folder path</Label>
            <Input
              id="quick-access-path"
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. src/App.tsx, package.json, docs/"
              autoFocus
              disabled={isPending}
            />
            {error ? <DialogErrorText>{error}</DialogErrorText> : null}
          </DialogField>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <StatefulButton
              type="submit"
              state={isPending ? "loading" : "idle"}
              icon={<Pin size={14} />}
              disabled={!pathInput.trim()}
              loadingText="Pinning…"
            >
              Pin item
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
