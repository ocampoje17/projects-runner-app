export type ProjectNote = {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export function parseProjectNotes(value: string | null | undefined): ProjectNote[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const content = typeof item.content === "string" ? item.content : "";
        if (!content.trim()) {
          return null;
        }

        const fallbackTime = new Date().toISOString();
        return {
          id: typeof item.id === "string" && item.id ? item.id : `note-${index}-${fallbackTime}`,
          content,
          pinned: Boolean(item.pinned),
          createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : fallbackTime,
          updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : fallbackTime,
        } satisfies ProjectNote;
      })
      .filter((item): item is ProjectNote => Boolean(item));
  } catch {
    const content = value.trim();
    if (!content) {
      return [];
    }

    const fallbackTime = new Date().toISOString();
    return [
      {
        id: `legacy-note-${fallbackTime}`,
        content,
        pinned: false,
        createdAt: fallbackTime,
        updatedAt: fallbackTime,
      },
    ];
  }
}

export function serializeProjectNotes(notes: ProjectNote[]) {
  const cleanNotes = notes
    .map((note) => ({
      ...note,
      content: note.content.trim(),
    }))
    .filter((note) => note.content);

  return cleanNotes.length > 0 ? JSON.stringify(cleanNotes) : null;
}

export function sortProjectNotes(notes: ProjectNote[]) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
