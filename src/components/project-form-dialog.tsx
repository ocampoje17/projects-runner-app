import { zodResolver } from "@hookform/resolvers/zod";
import { Download, FolderOpen, Save, Trash2 } from "lucide-react";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { EntityAvatar, lucideIconValue } from "./entity-avatar";
import { AvatarPicker, FieldError } from "./dialog-shared";
import { Button } from "./ui/button";
import { StatefulButton } from "./ui/stateful-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { DialogField, DialogFooter, DialogForm, DialogInlineField } from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { api, Project, ProjectInput } from "../lib/api";

const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  path: z.string().min(1, "Project folder is required"),
  description: z.string().optional(),
  avatar_path: z.string().nullable().optional(),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export function ProjectDialog({
  open,
  project,
  isPending,
  onDelete,
  onError,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  project: Project | null;
  isPending: boolean;
  onDelete: (project: Project) => void;
  onError: (error: unknown) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProjectInput) => void;
}) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? "",
      path: project?.path ?? "",
      description: project?.description ?? "",
      avatar_path: project?.avatar_path ?? null,
    },
  });
  const avatar = form.watch("avatar_path");

  async function pickFolder() {
    const path = await api.pickProjectFolder();
    if (path) {
      form.setValue("path", path, { shouldValidate: true });
    }
  }

  async function pickAvatar() {
    try {
      const path = await api.pickAndCopyAvatar("project", project?.id);
      if (path) {
        form.setValue("avatar_path", path, { shouldValidate: true });
      }
    } catch (error) {
      onError(error);
    }
  }

  function pickIcon(iconId: string) {
    form.setValue("avatar_path", lucideIconValue(iconId), { shouldValidate: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(500px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "Add project"}</DialogTitle>
          <DialogDescription>Save a folder you work in and group its commands.</DialogDescription>
        </DialogHeader>
        <DialogForm className="flex flex-col gap-2.5" onSubmit={form.handleSubmit((values) => onSubmit(values))}>
          <AvatarPicker
            name={form.watch("name") || "Project"}
            avatarPath={avatar}
            onPickImage={pickAvatar}
            onPickIcon={pickIcon}
          />
          <DialogField>
            <Label>Name</Label>
            <Input {...form.register("name")} placeholder="Frontend app" />
            <FieldError message={form.formState.errors.name?.message} />
          </DialogField>

          <DialogField>
            <Label>Folder</Label>
            <DialogInlineField>
              <Input {...form.register("path")} placeholder="/Users/you/projects/my-app or C:\\Projects\\my-app" />
              <Button type="button" variant="secondary" onClick={pickFolder}>
                <FolderOpen size={16} />
              </Button>
            </DialogInlineField>
            <FieldError message={form.formState.errors.path?.message} />
          </DialogField>

          <DialogField>
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              rows={3}
              placeholder="Optional notes"
              className="bg-[var(--vscode-editor)] text-[12px] leading-6"
            />
          </DialogField>

          <DialogFooter>
            {project && (
              <Button type="button" variant="danger" onClick={() => onDelete(project)}>
                <Trash2 size={16} />
                Delete
              </Button>
            )}
            <StatefulButton
              type="submit"
              state={isPending ? "loading" : "idle"}
              icon={<Save size={16} />}
              loadingText="Saving"
            >
              Save
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

export function ExportProjectDialog({
  isPending,
  open,
  project,
  onOpenChange,
  onSave,
}: {
  isPending: boolean;
  open: boolean;
  project: Project;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>Export project</DialogTitle>
          <DialogDescription>Save this project and its commands as a .prd file.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-3">
          <EntityAvatar name={project.name} path={project.avatar_path} />
          <div className="min-w-0">
            <strong className="block truncate text-[12px] text-foreground">{project.name}</strong>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{project.path}</span>
          </div>
        </div>
        <DialogFooter>
          <StatefulButton
            onClick={onSave}
            state={isPending ? "loading" : "idle"}
            icon={<Download size={16} />}
            loadingText="Exporting"
          >
            Save
          </StatefulButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

