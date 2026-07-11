import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectInput } from "../lib/api";
import { parseProjectNotes, serializeProjectNotes, sortProjectNotes, type ProjectNote } from "../lib/project-notes";

export function useProjectNotes({
  selectedProject,
  onPersist,
}: {
  selectedProject: Project | null;
  onPersist: (projectId: number, input: ProjectInput, successTitle: string) => void;
}) {
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [newProjectNote, setNewProjectNote] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("project_note_visibility");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("project_note_visibility", JSON.stringify(noteVisibility));
  }, [noteVisibility]);

  useEffect(() => {
    setProjectNotes(parseProjectNotes(selectedProject?.notes));
    setNewProjectNote("");
  }, [selectedProject?.id, selectedProject?.notes]);

  const sortedProjectNotes = useMemo(() => sortProjectNotes(projectNotes), [projectNotes]);

  function persistProjectNotes(nextNotes: ProjectNote[], successTitle: string) {
    if (!selectedProject) {
      return;
    }

    onPersist(
      selectedProject.id,
      {
        name: selectedProject.name,
        path: selectedProject.path,
        avatar_path: selectedProject.avatar_path,
        description: selectedProject.description,
        notes: serializeProjectNotes(nextNotes),
      },
      successTitle,
    );
  }

  function handleAddProjectNote() {
    const content = newProjectNote.trim();
    if (!content) {
      return;
    }

    const timestamp = new Date().toISOString();
    const nextNotes = [
      {
        id: `note-${crypto.randomUUID()}`,
        content,
        pinned: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...projectNotes,
    ];

    setProjectNotes(nextNotes);
    setNewProjectNote("");
    persistProjectNotes(nextNotes, "Note added");
  }

  function handleSaveEditedProjectNote(noteId: string, content: string) {
    const nextNotes = projectNotes
      .map((note) =>
        note.id === noteId
          ? {
              ...note,
              content: content.trim(),
              updatedAt: new Date().toISOString(),
            }
          : note,
      )
      .filter((note) => note.content);

    setProjectNotes(nextNotes);
    persistProjectNotes(nextNotes, "Note updated");
  }

  function handleDeleteProjectNote(noteId: string) {
    const nextNotes = projectNotes.filter((note) => note.id !== noteId);
    setProjectNotes(nextNotes);
    setNoteVisibility((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    persistProjectNotes(nextNotes, "Note deleted");
  }

  function handleTogglePinnedProjectNote(noteId: string) {
    const nextNotes = projectNotes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            pinned: !note.pinned,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    setProjectNotes(nextNotes);
    persistProjectNotes(nextNotes, nextNotes.find((note) => note.id === noteId)?.pinned ? "Note pinned" : "Note unpinned");
  }

  function handleToggleProjectNoteVisibility(noteId: string) {
    setNoteVisibility((current) => ({
      ...current,
      [noteId]: current[noteId] === undefined ? false : !current[noteId],
    }));
  }

  return {
    projectNotes,
    setProjectNotes,
    sortedProjectNotes,
    newProjectNote,
    setNewProjectNote,
    noteVisibility,
    handleAddProjectNote,
    handleSaveEditedProjectNote,
    handleDeleteProjectNote,
    handleTogglePinnedProjectNote,
    handleToggleProjectNoteVisibility,
  };
}
