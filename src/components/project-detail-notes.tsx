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
    <div className="project-notes-layout">
      <div className="project-notes-stack">
        <div className="project-notes-header">
          <div>
            <h3>Project notes</h3>
            <p>Ghi chú ngắn theo từng mảnh, có thể ghim note quan trọng lên đầu.</p>
          </div>
          <Badge variant="muted">{selectedProject.name}</Badge>
        </div>

        <div className="project-note-composer">
          <Textarea
            value={newProjectNote}
            onChange={(event) => onNewProjectNoteChange(event.target.value)}
            rows={3}
            placeholder="Thêm một note mới, ví dụ: cách start local, tài khoản test, checklist deploy..."
          />
          <div className="project-note-composer-actions">
            <Button onClick={onAddProjectNote} disabled={!newProjectNote.trim() || isSavingNotes}>
              {isSavingNotes ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Thêm note
            </Button>
          </div>
        </div>

        {sortedProjectNotes.length > 0 ? (
          <div className="project-notes-grid">
            {sortedProjectNotes.map((note) => {
              const isVisible = noteVisibility[note.id] ?? true;

              return (
                <article key={note.id} className={`project-note-item ${note.pinned ? "pinned" : ""}`}>
                  <div className="project-note-item-header">
                    <div className="project-note-meta">
                      <Badge variant={note.pinned ? "success" : "muted"}>{note.pinned ? "Pinned" : "Note"}</Badge>
                      <span>{new Date(note.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="project-note-actions">
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
                        className="project-note-textarea"
                      />
                      <div className="project-note-footer">
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
                    <div className="project-note-collapsed">
                      <p>Nội dung note đang được ẩn.</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="notes-hidden-state">
            <p>Chưa có note nào cho project này. Thêm note đầu tiên ở ô phía trên.</p>
          </div>
        )}
      </div>
    </div>
  );
}
