import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, Pencil, Pin, PinOff, Plus, Save, Search, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Project } from "../lib/api";
import {
  buildProjectNoteMeta,
  compareProjectNoteMeta,
  noteTitle,
  projectNoteVisibilityKey,
  type ProjectNoteSortDirection,
  type ProjectNoteSortField,
} from "../lib/project-notes";
import { formatDateTime } from "../lib/date-time";
import { Tooltip } from "./motion/tooltip";
import type { ProjectNote } from "./project-detail-types";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogField, DialogFooter, DialogForm } from "./ui/dialog-form";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { StatefulButton } from "./ui/stateful-button";
import { Textarea } from "./ui/textarea";

export type ProjectNoteDraftValue = {
  title: string;
  content: string;
};

export function MarkdownNote({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`markdown-note rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2.5 text-[12px] leading-6 text-foreground ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

type NoteDialogMode = "create" | "edit";

const SORT_FIELD_OPTIONS: { value: ProjectNoteSortField; label: string }[] = [
  { value: "updatedAt", label: "Updated time" },
  { value: "createdAt", label: "Created time" },
  { value: "title", label: "Title" },
  { value: "length", label: "Length" },
  { value: "visibility", label: "Visibility" },
];

const SORT_DIRECTION_OPTIONS: { value: ProjectNoteSortDirection; label: string }[] = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
];

export function ProjectNoteDialog({
  mode,
  open,
  onOpenChange,
  projectName,
  value,
  onValueChange,
  onSubmit,
  isSaving,
  errorMessage,
}: {
  mode: NoteDialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  value: ProjectNoteDraftValue;
  onValueChange: (field: keyof ProjectNoteDraftValue, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
  errorMessage?: string | null;
}) {
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsPreviewExpanded(false);
    }
  }, [open]);

  const title = mode === "create" ? "Add note" : "Edit note";
  const description =
    mode === "create"
      ? (
        <>
          Write a note for <span className="font-medium text-foreground">{projectName}</span>. Markdown is supported
          so it stays easy to scan later.
        </>
      )
      : (
        <>
          Update the note for <span className="font-medium text-foreground">{projectName}</span>. Markdown formatting
          stays intact so you can keep editing comfortably.
        </>
      );
  const submitLabel = mode === "create" ? "Add note" : "Save changes";
  const submitIcon = mode === "create" ? <Plus size={16} /> : <Save size={16} />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogForm onSubmit={onSubmit}>
          {errorMessage ? (
            <div
              id={`${mode}-project-note-error`}
              role="alert"
              className="rounded-[6px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
            >
              {errorMessage}
            </div>
          ) : null}

          <DialogField>
            <Label htmlFor={`${mode}-project-note-title`}>Note title</Label>
            <Input
              id={`${mode}-project-note-title`}
              value={value.title}
              onChange={(event) => onValueChange("title", event.target.value)}
              placeholder="Local setup"
              aria-invalid={Boolean(errorMessage && !value.title.trim())}
              aria-describedby={errorMessage ? `${mode}-project-note-error` : undefined}
              autoFocus
            />
          </DialogField>

          <DialogField>
            <Label htmlFor={`${mode}-project-note-content`}>Note content</Label>
            <Textarea
              id={`${mode}-project-note-content`}
              value={value.content}
              onChange={(event) => onValueChange("content", event.target.value)}
              rows={10}
              aria-invalid={Boolean(mode === "create" && errorMessage && !value.content.trim())}
              aria-describedby={errorMessage ? `${mode}-project-note-error` : undefined}
              className="min-h-[220px] bg-[var(--script-preview-bg)] font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)]"
              placeholder={"## Local setup\n- `pnpm install`\n- `pnpm dev`\n\n### Test accounts\n- user: demo@example.com\n- pass: demo123"}
            />
            <p className="text-[11.5px] text-muted-foreground">
              Tip: use headings, lists, code blocks, and markdown checklists so the note stays easy to scan.
            </p>
          </DialogField>

          {value.content.trim() ? (
            <DialogField>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:bg-[var(--vscode-list-active)]"
                onClick={() => setIsPreviewExpanded((current) => !current)}
                aria-expanded={isPreviewExpanded}
              >
                <span>
                  <span className="block text-[12.5px] font-normal text-foreground">Preview</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    Collapsed by default. Click to {isPreviewExpanded ? "hide" : "expand"} the markdown preview.
                  </span>
                </span>
                {isPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isPreviewExpanded ? <MarkdownNote content={value.content} /> : null}
            </DialogField>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <StatefulButton
              type="submit"
              disabled={!value.title.trim() || (mode === "create" && !value.content.trim())}
              state={isSaving ? "loading" : "idle"}
              icon={submitIcon}
              loadingText="Saving"
            >
              {submitLabel}
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectDetailNotes({
  selectedProject,
  sortedProjectNotes,
  noteVisibility,
  newProjectNote,
  onNewProjectNoteChange,
  onAddProjectNote,
  onEditProjectNote,
  onTogglePinnedProjectNote,
  onToggleProjectNoteVisibility,
  onDeleteProjectNote,
  onOpenProjectNote,
  isSavingNotes,
}: {
  selectedProject: Project;
  sortedProjectNotes: ProjectNote[];
  noteVisibility: Record<string, boolean>;
  newProjectNote: ProjectNoteDraftValue;
  onNewProjectNoteChange: (field: keyof ProjectNoteDraftValue, value: string) => void;
  onAddProjectNote: () => Promise<void> | void;
  onEditProjectNote: (noteId: string, title: string, content: string, expectedNote?: ProjectNote) => Promise<void> | void;
  onTogglePinnedProjectNote: (noteId: string) => void;
  onToggleProjectNoteVisibility: (noteId: string) => void;
  onDeleteProjectNote: (noteId: string) => void;
  onOpenProjectNote: (noteId: string) => void;
  isSavingNotes: boolean;
}) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addNoteError, setAddNoteError] = useState<string | null>(null);
  const [editingOriginal, setEditingOriginal] = useState<ProjectNote | undefined>();
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ProjectNoteDraftValue>({ title: "", content: "" });
  const [editNoteError, setEditNoteError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<ProjectNoteSortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<ProjectNoteSortDirection>("desc");

  const visibleNotes = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase();

    return sortedProjectNotes
      .map((note) => ({
        note,
        meta: buildProjectNoteMeta(note, noteVisibility[projectNoteVisibilityKey(selectedProject.id, note.id)] ?? true),
      }))
      .filter(({ meta }) => (normalizedSearch ? meta.searchText.includes(normalizedSearch) : true))
      .sort((left, right) => compareProjectNoteMeta(left.meta, right.meta, sortField, sortDirection));
  }, [noteVisibility, searchQuery, selectedProject.id, sortDirection, sortField, sortedProjectNotes]);

  function closeAddDialog(open: boolean) {
    setIsAddDialogOpen(open);
    if (!open) {
      setAddNoteError(null);
      onNewProjectNoteChange("title", "");
      onNewProjectNoteChange("content", "");
    }
  }

  async function handleSubmitNewNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddNoteError(null);
    if (!newProjectNote.title.trim() || !newProjectNote.content.trim()) {
      setAddNoteError("Both title and content are required.");
      return;
    }

    try {
      await onAddProjectNote();
      setIsAddDialogOpen(false);
      setAddNoteError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || "Failed to save note");
      setAddNoteError(message);
    }
  }

  function openEditDialog(note: ProjectNote) {
    setEditingNoteId(note.id);
    setEditingOriginal(note);
    setEditNoteError(null);
    setEditingDraft({
      title: note.title,
      content: note.content,
    });
  }

  function closeEditDialog(open: boolean) {
    if (!open) {
      setEditingNoteId(null);
      setEditingDraft({ title: "", content: "" });
      setEditNoteError(null);
    }
  }

  async function handleSubmitEditNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditNoteError(null);
    if (!editingNoteId || !editingDraft.title.trim()) {
      setEditNoteError("Note title is required.");
      return;
    }

    try {
      await onEditProjectNote(editingNoteId, editingDraft.title, editingDraft.content, editingOriginal);
      closeEditDialog(false);
      setEditNoteError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || "Failed to update note");
      setEditNoteError(message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--vscode-border)] pb-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/82">Notes workspace</h3>
          <p className="text-[11.5px] text-muted-foreground">Keep setup docs, checklists, and project context in one place.</p>
        </div>
        <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
          <Plus size={14} />
          Add note
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Project notes
            </div>
            <div className="h-px flex-1 bg-[var(--vscode-border)]" aria-hidden="true" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_220px_180px]">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by title or content"
                className="pl-9"
                aria-label="Search project notes"
              />
            </div>
            <Select value={sortField} onValueChange={(value) => setSortField(value as ProjectNoteSortField)}>
              <SelectTrigger aria-label="Sort notes by">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_FIELD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as ProjectNoteSortDirection)}>
              <SelectTrigger aria-label="Sort direction">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                {SORT_DIRECTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {visibleNotes.length} / {sortedProjectNotes.length} notes
          </div>
        </div>

        {visibleNotes.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            {visibleNotes.map(({ note, meta }) => {
              const title = noteTitle(note, "Untitled note");
              const isVisible = meta.isVisible;
              const createdTooltip = `Created ${formatDateTime(note.createdAt)}`;

              return (
                <Tooltip key={note.id} content={createdTooltip}>
                  <article className="rounded-[10px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3 shadow-none transition-colors hover:border-border-strong hover:bg-[var(--bg-card-hover)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <h4 className="block truncate whitespace-nowrap text-[13px] font-semibold text-foreground">{title}</h4>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Created {formatDateTime(note.createdAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1 pl-1">
                        <Tooltip content="View detail">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onOpenProjectNote(note.id)}>
                            <Eye size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip content={note.pinned ? "Unpin note" : "Pin note"}>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onTogglePinnedProjectNote(note.id)}>
                            {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                          </Button>
                        </Tooltip>
                        <Tooltip content="Edit note">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditDialog(note)}>
                            <Pencil size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip content={isVisible ? "Hide content" : "Show content"}>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onToggleProjectNoteVisibility(note.id)}>
                            {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </Button>
                        </Tooltip>
                        <Tooltip content="Copy content">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void navigator.clipboard.writeText(note.content)}>
                            <Copy size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip content="Delete note">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-[var(--vscode-danger)] hover:text-[var(--vscode-danger)]" onClick={() => onDeleteProjectNote(note.id)}>
                            <Trash2 size={14} className="text-[var(--vscode-danger)]" />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="my-3 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

                    <div className="mt-3">
                      {isVisible ? (
                        <MarkdownNote content={note.content} className="max-h-[360px] overflow-y-auto" />
                      ) : (
                        <div className="rounded-[6px] border border-dashed border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-6 text-center text-[12px] text-muted-foreground">
                          This note is hidden. Use the visibility action to show its content again.
                        </div>
                      )}
                    </div>
                  </article>
                </Tooltip>
              );
            })}
          </div>
        ) : sortedProjectNotes.length > 0 ? (
          <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              No notes match the current search or sort context.
            </p>
          </div>
        ) : (
          <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              No notes exist for this project yet. Add the first one to capture checklists, test accounts, or local run steps.
            </p>
          </div>
        )}
      </div>

      <ProjectNoteDialog
        mode="create"
        open={isAddDialogOpen}
        onOpenChange={closeAddDialog}
        projectName={selectedProject.name}
        value={newProjectNote}
        onValueChange={onNewProjectNoteChange}
        onSubmit={handleSubmitNewNote}
        isSaving={isSavingNotes}
        errorMessage={addNoteError}
      />

      <ProjectNoteDialog
        mode="edit"
        open={Boolean(editingNoteId)}
        onOpenChange={closeEditDialog}
        projectName={selectedProject.name}
        value={editingDraft}
        onValueChange={(field, value) => setEditingDraft((current) => ({ ...current, [field]: value }))}
        onSubmit={handleSubmitEditNote}
        isSaving={isSavingNotes}
        errorMessage={editNoteError}
      />
    </div>
  );
}
