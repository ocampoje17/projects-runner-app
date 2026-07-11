import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Pencil, Pin, PinOff, Plus, Save, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Project } from "../lib/api";
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
    <div className="markdown-note max-h-[280px] overflow-y-auto rounded-[14px] bg-input px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
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

  const title = mode === "create" ? "Thêm note mới" : "Sửa note";
  const description =
    mode === "create"
      ? (
        <>
          Viết ghi chú cho <span className="font-medium text-foreground">{projectName}</span>. Hỗ trợ Markdown để dễ
          đọc hơn khi xem lại.
        </>
      )
      : (
        <>
          Cập nhật nội dung note của <span className="font-medium text-foreground">{projectName}</span>. Markdown sẽ
          được giữ nguyên để bạn chỉnh sửa tiếp thuận tiện.
        </>
      );
  const submitLabel = mode === "create" ? "Thêm note" : "Lưu thay đổi";
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
            <Label htmlFor={`${mode}-project-note`}>Nội dung note</Label>
            <Textarea
              id={`${mode}-project-note`}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              rows={10}
              className="min-h-[220px] font-mono text-[12.5px]"
              placeholder={
                "## Local setup\n- `pnpm install`\n- `pnpm dev`\n\n### Tài khoản test\n- user: demo@example.com\n- pass: demo123"
              }
              autoFocus
            />
            <p className="text-[11.5px] text-muted-foreground">
              Gợi ý: dùng heading, list, code block và checklist Markdown để note dễ quét hơn.
            </p>
          </DialogField>

          {value.trim() ? (
            <DialogField>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[14px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_72%,var(--bg-workspace))] px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-card"
                onClick={() => setIsPreviewExpanded((current) => !current)}
                aria-expanded={isPreviewExpanded}
              >
                <span>
                  <span className="block text-[12.5px] font-medium text-foreground">Xem trước</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    Mặc định thu gọn. Nhấn để {isPreviewExpanded ? "thu gọn lại" : "mở rộng"} bản xem trước Markdown.
                  </span>
                </span>
                {isPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isPreviewExpanded ? <MarkdownNote content={value} /> : null}
            </DialogField>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Hủy
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
  onToggleProjectNoteVisibility: (noteId: string) => void;
  onDeleteProjectNote: (noteId: string) => void;
  isSavingNotes: boolean;
}) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const editingNote = useMemo(
    () => sortedProjectNotes.find((note) => note.id === editingNoteId) ?? null,
    [editingNoteId, sortedProjectNotes],
  );

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
      <div className="flex shrink-0 justify-end">
        <Button size="sm" onClick={openAddDialog}>
          <Plus size={14} />
          Thêm note
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        {sortedProjectNotes.length > 0 ? (
          <div className="notes-masonry">
            {sortedProjectNotes.map((note) => {
              const isVisible = noteVisibility[note.id] ?? true;

              return (
                <article
                  key={note.id}
                  className={`notes-masonry-item flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3 shadow-app-card ${
                    note.pinned ? "border-primary/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {note.pinned ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-primary">
                          <Pin size={11} />
                          Pinned
                        </span>
                      ) : null}
                      <span>{new Date(note.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onToggleProjectNoteVisibility(note.id)}>
                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                        {isVisible ? "Ẩn" : "Hiện"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onTogglePinnedProjectNote(note.id)}>
                        {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        {note.pinned ? "Bỏ ghim" : "Ghim"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDeleteProjectNote(note.id)}>
                        <Trash2 size={14} />
                        Xóa
                      </Button>
                    </div>
                  </div>

                  {isVisible ? (
                    <>
                      <MarkdownNote content={note.content} />
                      <div className="flex items-center justify-end">
                        <Button size="sm" variant="ghost" onClick={() => startEditingNote(note)}>
                          <Pencil size={14} />
                          Sửa
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[14px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_84%,var(--bg-workspace))] px-2.5 py-2 text-[12.5px] text-muted-foreground">
                      <p>Nội dung note đang được ẩn.</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-border px-3 py-8 text-center">
            <p className="text-[12.5px] text-muted-foreground">
              Chưa có note nào cho project này. Thêm note đầu tiên để ghi lại checklist, tài khoản test hoặc cách chạy local.
            </p>
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={openAddDialog}>
                <Plus size={14} />
                Thêm note
              </Button>
            </div>
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
