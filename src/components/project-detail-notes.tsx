import { Eye, EyeOff, Loader2, Pin, PinOff, Plus, Save, Trash2 } from "lucide-react";
import type { Project } from "../lib/api";
import type { ProjectNote } from "./project-detail-types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

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
  return (
    <div className="project-notes-layout flex min-h-0 flex-1 flex-col gap-3">
      <div className="project-notes-stack flex min-h-0 flex-1 flex-col gap-3">
        <div className="project-notes-header flex flex-col gap-1">
          <div>
            <h3>Project notes</h3>
            <p>Ghi chú ngắn theo từng mảnh, có thể ghim note quan trọng lên đầu.</p>
          </div>
          <Badge variant="muted">{selectedProject.name}</Badge>
        </div>

        <div className="project-note-composer flex flex-col gap-2 rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
          <Textarea
            value={newProjectNote}
            onChange={(event) => onNewProjectNoteChange(event.target.value)}
            rows={3}
            placeholder="Thêm một note mới, ví dụ: cách start local, tài khoản test, checklist deploy..."
          />
          <div className="project-note-composer-actions flex justify-end">
            <Button onClick={onAddProjectNote} disabled={!newProjectNote.trim() || isSavingNotes}>
              {isSavingNotes ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Thêm note
            </Button>
          </div>
        </div>

        {sortedProjectNotes.length > 0 ? (
          <div className="project-notes-grid grid grid-cols-1 gap-2 md:grid-cols-2">
            {sortedProjectNotes.map((note) => {
              const isVisible = noteVisibility[note.id] ?? true;

              return (
                <article key={note.id} className={`project-note-item flex flex-col gap-2 rounded-[10px] border border-app-border bg-card p-3 shadow-app-card ${note.pinned ? "pinned border-primary/40" : ""}`}>
                  <div className="project-note-item-header flex items-start justify-between gap-2">
                    <div className="project-note-meta flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant={note.pinned ? "success" : "muted"}>{note.pinned ? "Pinned" : "Note"}</Badge>
                      <span>{new Date(note.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="project-note-actions flex items-center gap-1">
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
                      <Textarea
                        value={note.content}
                        onChange={(event) => onUpdateProjectNote(note.id, event.target.value)}
                        rows={4}
                        className="project-note-textarea min-h-[96px]"
                      />
                      <div className="project-note-footer flex items-center justify-between gap-2">
                        <Button
                          size="sm"
                          onClick={() => onSaveProjectNote(note.id)}
                          disabled={!note.content.trim() || isSavingNotes}
                        >
                          {isSavingNotes ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                          Lưu
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="project-note-collapsed rounded-[8px] bg-input px-2.5 py-2 text-[12.5px] text-muted-foreground">
                      <p>Nội dung note đang được ẩn.</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="notes-hidden-state rounded-[10px] border border-dashed border-app-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            <p>Chưa có note nào cho project này. Thêm note đầu tiên ở ô phía trên.</p>
          </div>
        )}
      </div>
    </div>
  );
}

