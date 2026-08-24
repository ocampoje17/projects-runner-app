import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectInput } from "../lib/api";
import {
  parseProjectNotes,
  projectNoteVisibilityKey,
  serializeProjectNotes,
  sortProjectNotes,
  type ProjectNote,
} from "../lib/project-notes";

type ProjectById = Record<number, Project>;
type ProjectNotesById = Record<number, ProjectNote[]>;
type ProjectNoteDraft = {
  title: string;
  content: string;
};
type DraftsByProjectId = Record<number, ProjectNoteDraft>;

function buildProjectMap(projects: Project[]): ProjectById {
  if (!Array.isArray(projects)) return {};
  return projects.reduce<ProjectById>((acc, project) => {
    if (project) {
      acc[project.id] = project;
    }
    return acc;
  }, {});
}

function buildNotesMap(projects: Project[]): ProjectNotesById {
  if (!Array.isArray(projects)) return {};
  return projects.reduce<ProjectNotesById>((acc, project) => {
    if (project) {
      acc[project.id] = parseProjectNotes(project.notes);
    }
    return acc;
  }, {});
}

export function useProjectNotes({
  projects,
  onPersist,
}: {
  projects: Project[];
  onPersist: (projectId: number, input: ProjectInput, successTitle: string) => void;
}) {
  const [projectNotesById, setProjectNotesById] = useState<ProjectNotesById>(() => buildNotesMap(projects));
  const [newProjectNotesById, setNewProjectNotesById] = useState<DraftsByProjectId>({});
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
    setProjectNotesById(buildNotesMap(projects));
    setNewProjectNotesById((current) => {
      const next: DraftsByProjectId = {};
      if (Array.isArray(projects)) {
        for (const project of projects) {
          if (project) {
            next[project.id] = current[project.id] ?? { title: "", content: "" };
          }
        }
      }
      return next;
    });
  }, [projects]);

  const projectsById = useMemo(() => buildProjectMap(projects), [projects]);

  const sortedProjectNotesById = useMemo(
    () =>
      Object.entries(projectNotesById).reduce<ProjectNotesById>((acc, [projectId, notes]) => {
        acc[Number(projectId)] = sortProjectNotes(notes);
        return acc;
      }, {}),
    [projectNotesById],
  );

  function setNewProjectNote(projectId: number, field: keyof ProjectNoteDraft, value: string) {
    setNewProjectNotesById((current) => ({
      ...current,
      [projectId]: {
        title: field === "title" ? value : (current[projectId]?.title ?? ""),
        content: field === "content" ? value : (current[projectId]?.content ?? ""),
      },
    }));
  }

  function persistProjectNotes(projectId: number, nextNotes: ProjectNote[], successTitle: string) {
    const project = projectsById[projectId];
    if (!project) {
      return;
    }

    onPersist(
      project.id,
      {
        name: project.name,
        path: project.path,
        avatar_path: project.avatar_path,
        description: project.description,
        notes: serializeProjectNotes(nextNotes),
      },
      successTitle,
    );
  }

  function handleAddProjectNote(projectId: number) {
    const draft = newProjectNotesById[projectId];
    const title = draft?.title.trim();
    const content = draft?.content.trim();
    if (!title || !content) {
      return;
    }

    const timestamp = new Date().toISOString();
    const currentNotes = projectNotesById[projectId] ?? [];
    const nextNotes = [
      {
        id: `note-${crypto.randomUUID()}`,
        title,
        content,
        pinned: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...currentNotes,
    ];

    setProjectNotesById((current) => ({
      ...current,
      [projectId]: nextNotes,
    }));
    setNewProjectNotesById((current) => ({
      ...current,
      [projectId]: { title: "", content: "" },
    }));
    persistProjectNotes(projectId, nextNotes, "Note added");
  }

  function handleSaveEditedProjectNote(projectId: number, noteId: string, title: string, content: string) {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    const currentNotes = projectNotesById[projectId] ?? [];
    const nextNotes = currentNotes
      .map((note) =>
        note.id === noteId
          ? {
              ...note,
              title: normalizedTitle || note.title,
              content: normalizedContent,
              updatedAt: new Date().toISOString(),
            }
          : note,
      )
      .filter((note) => note.title || note.content);

    setProjectNotesById((current) => ({
      ...current,
      [projectId]: nextNotes,
    }));
    persistProjectNotes(projectId, nextNotes, "Note updated");
  }

  function handleDeleteProjectNote(projectId: number, noteId: string) {
    const currentNotes = projectNotesById[projectId] ?? [];
    const nextNotes = currentNotes.filter((note) => note.id !== noteId);
    const visibilityKey = projectNoteVisibilityKey(projectId, noteId);

    setProjectNotesById((current) => ({
      ...current,
      [projectId]: nextNotes,
    }));
    setNoteVisibility((current) => {
      const next = { ...current };
      delete next[visibilityKey];
      return next;
    });
    persistProjectNotes(projectId, nextNotes, "Note deleted");
  }

  function handleTogglePinnedProjectNote(projectId: number, noteId: string) {
    const currentNotes = projectNotesById[projectId] ?? [];
    const nextNotes = currentNotes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            pinned: !note.pinned,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    setProjectNotesById((current) => ({
      ...current,
      [projectId]: nextNotes,
    }));
    persistProjectNotes(
      projectId,
      nextNotes,
      nextNotes.find((note) => note.id === noteId)?.pinned ? "Note pinned" : "Note unpinned",
    );
  }

  function handleToggleProjectNoteVisibility(projectId: number, noteId: string) {
    const visibilityKey = projectNoteVisibilityKey(projectId, noteId);
    setNoteVisibility((current) => ({
      ...current,
      [visibilityKey]: current[visibilityKey] === undefined ? false : !current[visibilityKey],
    }));
  }

  return {
    projectNotesById,
    sortedProjectNotesById,
    newProjectNotesById,
    setNewProjectNote,
    noteVisibility,
    handleAddProjectNote,
    handleSaveEditedProjectNote,
    handleDeleteProjectNote,
    handleTogglePinnedProjectNote,
    handleToggleProjectNoteVisibility,
  };
}
