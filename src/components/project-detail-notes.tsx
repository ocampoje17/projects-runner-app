import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Pencil, Pin, PinOff, Plus, Save, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Project } from "../lib/api";
import { noteExcerpt, noteTitle, projectNoteVisibilityKey } from "../lib/project-notes";
import type { ProjectNote } from "./project-detail-types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { DialogField, DialogFooter, DialogForm } from "./ui/dialog-form";
import { Label } from "./ui/label";
import { StatefulButton } from "./ui/stateful-button";
import { Textarea } from "./ui/textarea";

function MarkdownNote({ content }: { content: string }) {
  return (
    <div className="markdown-note max-h-[280px] overflow-y-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2.5 text-[12px] leading-6 text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

type NoteDialogMode = "create" | "edit";

function ProjectNoteDialog({
  mode,
  open,
  onOpenChange,
  projectName,
  value,
  onValueChange,
  onSubmit,
  isSaving,
}: {
  mode: NoteDialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
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
          <DialogField>
            <Label htmlFor={`${mode}-project-note`}>Note content</Label>
            <Textarea
              id={`${mode}-project-note`}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              rows={10}
              className="min-h-[220px] bg-[var(--script-preview-bg)] font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)]"
              placeholder={"## Local setup\n- `pnpm install`\n- `pnpm dev`\n\n### Test accounts\n- user: demo@example.com\n- pass: demo123"}
              autoFocus
            />
            <p className="text-[11.5px] text-muted-foreground">
              Tip: use headings, lists, code blocks, and markdown checklists so the note stays easy to scan.
            </p>
          </DialogField>

          {value.trim() ? (
            <DialogField>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-[var(--vscode-list-hover)]"
                onClick={() => setIsPreviewExpanded((current) => !current)}
                aria-expanded={isPreviewExpanded}
              >
                <span>
                    <span className="block text-[12.5px] font-medium text-foreground">Preview</span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      Collapsed by default. Click to {isPreviewExpanded ? "hide" : "expand"} the markdown preview.
                    </span>
                  </span>
                {isPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isPreviewExpanded ? <MarkdownNote content={value} /> : null}
            </DialogField>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <StatefulButton
              type="submit"
              disabled={!value.trim()}
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
  onSaveProjectNote,
  onTogglePinnedProjectNote,
  onToggleProjectNoteVisibility,
  onDeleteProjectNote,
  isSavingNotes,
}: {
  selectedProject: Project;
  sortedProjectNotes: ProjectNote[];
  noteVisibility: Record<string, boolean>;
  newProjectNote: string;
  onNewProjectNoteChange: (value: string) => void;
  onAddProjectNote: () => void;
  onSaveProjectNote: (noteId: string, content: string) => void;
  onTogglePinnedProjectNote: (noteId: string) => void;
  onToggleProjectNoteVisibility: (projectId: number, noteId: string) => void;
  onDeleteProjectNote: (noteId: string) => void;
  isSavingNotes: boolean;
}) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const editingNote = useMemo(
    () => sortedProjectNotes.find((note) => note.id === editingNoteId) ?? null,
    [editingNoteId, sortedProjectNotes],
  );
  const selectedNote = useMemo(
    () => sortedProjectNotes.find((note) => note.id === selectedNoteId) ?? sortedProjectNotes[0] ?? null,
    [selectedNoteId, sortedProjectNotes],
  );
  const selectedNoteVisibilityKey = selectedNote ? projectNoteVisibilityKey(selectedProject.id, selectedNote.id) : null;
  const isSelectedNoteVisible = selectedNoteVisibilityKey ? (noteVisibility[selectedNoteVisibilityKey] ?? true) : true;

  useEffect(() => {
    if (!sortedProjectNotes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(sortedProjectNotes[0]?.id ?? null);
    }
  }, [selectedNoteId, sortedProjectNotes]);

  function openAddDialog() {
    setIsAddDialogOpen(true);
  }

  function closeAddDialog(open: boolean) {
    setIsAddDialogOpen(open);
    if (!open) {
      onNewProjectNoteChange("");
    }
  }

  function closeEditDialog(open: boolean) {
    if (!open) {
      setEditingNoteId(null);
      setEditingDraft("");
    }
  }

  function handleSubmitNewNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newProjectNote.trim()) {
      return;
    }

    onAddProjectNote();
    setIsAddDialogOpen(false);
  }

  function startEditingNote(note: ProjectNote) {
    setSelectedNoteId(note.id);
    setEditingNoteId(note.id);
    setEditingDraft(note.content);
  }

  function handleSubmitEditedNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingNoteId || !editingDraft.trim()) {
      return;
    }

    onSaveProjectNote(editingNoteId, editingDraft);
    closeEditDialog(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--vscode-border)] pb-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/82">Notes workspace</h3>
          <p className="text-[11.5px] text-muted-foreground">Keep setup docs, checklists, and project context in one place.</p>
        </div>
        <Button size="sm" onClick={openAddDialog}>
          <Plus size={14} />
          Add note
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)]">
          <div className="border-b border-[var(--vscode-border)] px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Project notes
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sortedProjectNotes.length > 0 ? (
              <div className="space-y-1.5">
                {sortedProjectNotes.map((note) => {
                  const title = noteTitle(note.content, "Untitled note");
                  const excerpt = noteExcerpt(note.content);
                  const isActive = selectedNote?.id === note.id;
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => setSelectedNoteId(note.id)}
                      className={`flex w-full flex-col gap-1 rounded-[6px] border px-3 py-2 text-left transition-colors ${
                        isActive
                          ? "border-[var(--vscode-border)] bg-[var(--vscode-list-active)]"
                          : "border-transparent bg-transparent hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-foreground">{title}</span>
                        {note.pinned ? <Pin size={12} className="shrink-0 text-primary" /> : null}
                      </div>
                      <span className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">{excerpt || "No preview available."}</span>
                      <span className="text-[10.5px] text-muted-foreground">{new Date(note.updatedAt).toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-8 text-center">
                <p className="text-[12px] text-muted-foreground">
                  No notes exist for this project yet. Add the first one to capture checklists, test accounts, or local run steps.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)]">
          {selectedNote ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--vscode-border)] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-[13px] font-semibold text-foreground">
                      {noteTitle(selectedNote.content)}
                    </h4>
                    {selectedNote.pinned ? (
                      <span className="inline-flex items-center gap-1 rounded-[6px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                        <Pin size={11} />
                        Pinned
                      </span>
                    ) : null}
                    {!isSelectedNoteVisible ? (
                      <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                        <EyeOff size={11} />
                        Hidden
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Updated {new Date(selectedNote.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => onToggleProjectNoteVisibility(selectedProject.id, selectedNote.id)}>
                    {isSelectedNoteVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                    {isSelectedNoteVisible ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onTogglePinnedProjectNote(selectedNote.id)}>
                    {selectedNote.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    {selectedNote.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => startEditingNote(selectedNote)}>
                    <Pencil size={13} />
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDeleteProjectNote(selectedNote.id)}>
                    <Trash2 size={13} />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-2">
                <div className="min-h-0 border-b border-[var(--vscode-border)] bg-[var(--vscode-editor)] xl:border-b-0 xl:border-r">
                  {isSelectedNoteVisible ? (
                    <div className="h-full overflow-y-auto p-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Preview
                      </div>
                      <MarkdownNote content={selectedNote.content} />
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[260px] items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
                      This note is hidden right now. Use the "Show" button to reveal it again.
                    </div>
                  )}
                </div>
                <div className="min-h-0 overflow-y-auto bg-[var(--vscode-panel)] p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Raw markdown
                  </div>
                  <pre className="min-h-full whitespace-pre-wrap break-words rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-3 font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)]">
                    {selectedNote.content}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center px-6 text-center">
              <div>
                <p className="text-[12.5px] text-muted-foreground">Select a note from the list on the left to inspect its content.</p>
                <div className="mt-3 flex justify-center">
                  <Button size="sm" onClick={openAddDialog}>
                    <Plus size={14} />
                    Add note
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
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
      />

      <ProjectNoteDialog
        mode="edit"
        open={Boolean(editingNote)}
        onOpenChange={closeEditDialog}
        projectName={selectedProject.name}
        value={editingDraft}
        onValueChange={setEditingDraft}
        onSubmit={handleSubmitEditedNote}
        isSaving={isSavingNotes}
      />
    </div>
  );
}
