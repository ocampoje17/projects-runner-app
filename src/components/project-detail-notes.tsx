import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Pencil, Pin, PinOff, Plus, Save, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Project } from "../lib/api";
import type { ProjectNote } from "./project-detail-types";
import { Badge } from "./ui/badge";
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

export function ProjectDetailNotes({
  selectedProject,
  sortedProjectNotes,
  noteVisibility,
  newProjectNote,
  onNewProjectNoteChange,
  onAddProjectNote,
  onUpdateProjectNote,
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
  onUpdateProjectNote: (noteId: string, content: string) => void;
  onSaveProjectNote: (noteId: string) => void;
  onTogglePinnedProjectNote: (noteId: string) => void;
  onToggleProjectNoteVisibility: (noteId: string) => void;
  onDeleteProjectNote: (noteId: string) => void;
  isSavingNotes: boolean;
}) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingNoteIds, setEditingNoteIds] = useState<Record<string, boolean>>({});
  const [editSnapshots, setEditSnapshots] = useState<Record<string, string>>({});

  function openAddDialog() {
    setIsAddDialogOpen(true);
  }

  function closeAddDialog(open: boolean) {
    setIsAddDialogOpen(open);
    if (!open) {
      onNewProjectNoteChange("");
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

  function startEditingNote(noteId: string, content: string) {
    setEditSnapshots((current) => ({ ...current, [noteId]: content }));
    setEditingNoteIds((current) => ({ ...current, [noteId]: true }));
  }

  function stopEditingNote(noteId: string, restore = false) {
    if (restore && editSnapshots[noteId] !== undefined) {
      onUpdateProjectNote(noteId, editSnapshots[noteId]);
    }

    setEditingNoteIds((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    setEditSnapshots((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
  }

  function handleSaveNote(noteId: string) {
    onSaveProjectNote(noteId);
    stopEditingNote(noteId);
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {sortedProjectNotes.map((note) => {
              const isVisible = noteVisibility[note.id] ?? true;
              const isEditing = editingNoteIds[note.id] ?? false;

              return (
                <article
                  key={note.id}
                  className={`flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3 shadow-app-card ${
                    note.pinned ? "border-primary/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant={note.pinned ? "success" : "muted"}>
                        {note.pinned ? "Pinned" : "Note"}
                      </Badge>
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
                    isEditing ? (
                      <>
                        <Textarea
                          value={note.content}
                          onChange={(event) => onUpdateProjectNote(note.id, event.target.value)}
                          rows={8}
                          className="min-h-[160px] font-mono text-[12.5px]"
                          placeholder={"Hỗ trợ Markdown, ví dụ:\n## Checklist\n- [ ] Deploy staging\n- [ ] Kiểm tra log"}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => stopEditingNote(note.id, true)}>
                            <X size={14} />
                            Hủy
                          </Button>
                          <StatefulButton
                            size="sm"
                            onClick={() => handleSaveNote(note.id)}
                            disabled={!note.content.trim()}
                            state={isSavingNotes ? "loading" : "idle"}
                            icon={<Save size={14} />}
                            loadingText="Saving"
                          >
                            Lưu
                          </StatefulButton>
                        </div>
                      </>
                    ) : (
                      <>
                        <MarkdownNote content={note.content} />
                        <div className="flex items-center justify-end">
                          <Button size="sm" variant="ghost" onClick={() => startEditingNote(note.id, note.content)}>
                            <Pencil size={14} />
                            Sửa
                          </Button>
                        </div>
                      </>
                    )
                  ) : (
                    <div className="rounded-[14px] bg-input px-2.5 py-2 text-[12.5px] text-muted-foreground">
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

      <Dialog open={isAddDialogOpen} onOpenChange={closeAddDialog}>
        <DialogContent className="w-[min(640px,calc(100vw-20px))]">
          <DialogHeader>
            <DialogTitle>Thêm note mới</DialogTitle>
            <DialogDescription>
              Viết ghi chú cho <span className="font-medium text-foreground">{selectedProject.name}</span>. Hỗ trợ
              Markdown để dễ đọc hơn khi xem lại.
            </DialogDescription>
          </DialogHeader>

          <DialogForm onSubmit={handleSubmitNewNote}>
            <DialogField>
              <Label htmlFor="new-project-note">Nội dung note</Label>
              <Textarea
                id="new-project-note"
                value={newProjectNote}
                onChange={(event) => onNewProjectNoteChange(event.target.value)}
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

            {newProjectNote.trim() ? (
              <DialogField>
                <Label>Xem trước</Label>
                <MarkdownNote content={newProjectNote} />
              </DialogField>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => closeAddDialog(false)}>
                Hủy
              </Button>
              <StatefulButton
                type="submit"
                disabled={!newProjectNote.trim()}
                state={isSavingNotes ? "loading" : "idle"}
                icon={<Plus size={16} />}
                loadingText="Saving"
              >
                Thêm note
              </StatefulButton>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
