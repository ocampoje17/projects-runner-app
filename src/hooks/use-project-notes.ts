import { useEffect, useMemo, useRef, useState } from "react";
import { api, isDesktopRuntime, type Project, type ProjectInput } from "../lib/api";
import {
  parseProjectNotes,
  projectNoteVersion,
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
  onPersist: (projectId: number, input: ProjectInput, successTitle: string) => Promise<void>;
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

  const persistQueuesRef = useRef<Record<number, Promise<void>>>({});

  function enqueuePersist(projectId: number, task: () => Promise<void>): Promise<void> {
    const prev = persistQueuesRef.current[projectId] ?? Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    persistQueuesRef.current[projectId] = next;
    return next;
  }

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

  async function persistProjectNotes(projectId: number, nextNotes: ProjectNote[], successTitle: string, expectedNote?: ProjectNote): Promise<ProjectNote[]> {
    const project = projectsById[projectId];
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (isDesktopRuntime()) {
      const previous = (projectNotesById[projectId] ?? []).map(note=>note.id===expectedNote?.id ? expectedNote : note);
      for (const note of nextNotes) {
        const old = previous.find(item => item.id === note.id);
        if (!old) await api.projectNotesMutate(projectId, "create", { title: note.title, content: note.content, pinned: note.pinned });
        else if (old.title !== note.title || old.content !== note.content || old.pinned !== note.pinned) {
          await api.projectNotesMutate(projectId, "update", { note_id: note.id, expected_version: await projectNoteVersion(old), title: note.title, content: note.content, pinned: note.pinned });
        }
      }
      for (const old of previous) {
        if (!nextNotes.some(note => note.id === old.id)) await api.projectNotesMutate(projectId, "delete", { note_id: old.id, expected_version: await projectNoteVersion(old) });
      }
      const saved = await api.projectNotesList(projectId);
      await onPersist(project.id, { name: project.name, path: project.path, avatar_path: project.avatar_path, description: project.description, notes: serializeProjectNotes(saved) }, successTitle);
      return saved;
    }
    await onPersist(project.id, { name: project.name, path: project.path, avatar_path: project.avatar_path, description: project.description, notes: serializeProjectNotes(nextNotes) }, successTitle);
    return nextNotes;
  }

  function handleAddProjectNote(projectId: number): Promise<void> {
    const draft = newProjectNotesById[projectId];
    const title = draft?.title?.trim();
    const content = draft?.content?.trim();
    if (!title || !content) {
      return Promise.reject(new Error("Note title and content cannot be empty."));
    }

    return enqueuePersist(projectId, async () => {
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

      const saved = await persistProjectNotes(projectId, nextNotes, "Note added");

      setProjectNotesById((current) => ({
        ...current,
        [projectId]: saved,
      }));
      setNewProjectNotesById((current) => ({
        ...current,
        [projectId]: { title: "", content: "" },
      }));
    });
  }

  function handleSaveEditedProjectNote(
    projectId: number,
    noteId: string,
    title: string,
    content: string,
    expectedNote?: ProjectNote,
  ): Promise<void> {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle) {
      return Promise.reject(new Error("Note title cannot be empty."));
    }

    return enqueuePersist(projectId, async () => {
      const currentNotes = projectNotesById[projectId] ?? [];
      const nextNotes = currentNotes
        .map((note) =>
          note.id === noteId
            ? {
                ...note,
                title: normalizedTitle,
                content: normalizedContent,
                updatedAt: new Date().toISOString(),
              }
            : note,
        )
        .filter((note) => note.title || note.content);

      if(expectedNote&&!currentNotes.some(note=>note.id===noteId)) throw new Error("Note changed. Reload before saving.");
      const saved = await persistProjectNotes(projectId, nextNotes, "Note updated", expectedNote);

      setProjectNotesById((current) => ({
        ...current,
        [projectId]: saved,
      }));
    });
  }

  function handleDeleteProjectNote(projectId: number, noteId: string): Promise<void> {
    return enqueuePersist(projectId, async () => {
      const currentNotes = projectNotesById[projectId] ?? [];
      const nextNotes = currentNotes.filter((note) => note.id !== noteId);
      const visibilityKey = projectNoteVisibilityKey(projectId, noteId);

      const saved = await persistProjectNotes(projectId, nextNotes, "Note deleted");

      setProjectNotesById((current) => ({
        ...current,
        [projectId]: saved,
      }));
      setNoteVisibility((current) => {
        const next = { ...current };
        delete next[visibilityKey];
        return next;
      });
    });
  }

  function handleTogglePinnedProjectNote(projectId: number, noteId: string): Promise<void> {
    return enqueuePersist(projectId, async () => {
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

      const saved = await persistProjectNotes(
        projectId,
        nextNotes,
        nextNotes.find((note) => note.id === noteId)?.pinned ? "Note pinned" : "Note unpinned",
      );

      setProjectNotesById((current) => ({
        ...current,
        [projectId]: saved,
      }));
    });
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
