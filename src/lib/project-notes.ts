export type ProjectNote = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectNoteSortField = "updatedAt" | "createdAt" | "title" | "length" | "visibility";
export type ProjectNoteSortDirection = "desc" | "asc";

export type ProjectNoteMeta = {
  id: string;
  title: string;
  plainText: string;
  searchText: string;
  contentLength: number;
  createdAtMs: number;
  updatedAtMs: number;
  isVisible: boolean;
};

export function projectNoteVisibilityKey(projectId: number, noteId: string) {
  return `${projectId}:${noteId}`;
}

function deriveNoteTitleFromContent(content: string) {
  return content.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, "").trim() || "";
}

export function noteTitle(noteOrContent: ProjectNote | string, fallback = "Project Note") {
  if (typeof noteOrContent === "string") {
    return deriveNoteTitleFromContent(noteOrContent) || fallback;
  }

  return noteOrContent.title.trim() || deriveNoteTitleFromContent(noteOrContent.content) || fallback;
}

export function noteExcerpt(noteOrContent: ProjectNote | string) {
  const content = typeof noteOrContent === "string" ? noteOrContent : noteOrContent.content;
  const title = typeof noteOrContent === "string" ? noteTitle(noteOrContent, "") : noteTitle(noteOrContent, "");
  const lines = notePlainText(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const excerptSource = lines.slice(1).join(" ").trim() || lines.join(" ").trim();
  return excerptSource.replace(/\s{2,}/g, " ").trim() || title;
}

export function notePlainText(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#+\s*/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
        .replace(/[>*_~]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

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
        const title = typeof item.title === "string" ? item.title.trim() : "";
        if (!content.trim() && !title) {
          return null;
        }

        const fallbackTime = new Date().toISOString();
        return {
          id: typeof item.id === "string" && item.id ? item.id : `note-${index}-${fallbackTime}`,
          title: title || deriveNoteTitleFromContent(content) || "Untitled note",
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
        title: deriveNoteTitleFromContent(content) || "Untitled note",
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
      title: note.title.trim(),
      content: note.content.trim(),
    }))
    .filter((note) => note.title || note.content);

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

export function buildProjectNoteMeta(note: ProjectNote, isVisible: boolean): ProjectNoteMeta {
  const title = noteTitle(note, "Untitled note");
  const plainText = notePlainText(note.content);
  return {
    id: note.id,
    title,
    plainText,
    searchText: `${title}\n${plainText}`.toLocaleLowerCase(),
    contentLength: plainText.replace(/\s+/g, "").length,
    createdAtMs: new Date(note.createdAt).getTime(),
    updatedAtMs: new Date(note.updatedAt).getTime(),
    isVisible,
  };
}

export function compareProjectNoteMeta(
  left: ProjectNoteMeta,
  right: ProjectNoteMeta,
  sortField: ProjectNoteSortField,
  sortDirection: ProjectNoteSortDirection,
) {
  let result = 0;

  switch (sortField) {
    case "createdAt":
      result = left.createdAtMs - right.createdAtMs;
      break;
    case "updatedAt":
      result = left.updatedAtMs - right.updatedAtMs;
      break;
    case "title":
      result = left.title.localeCompare(right.title, undefined, { sensitivity: "base", numeric: true });
      break;
    case "length":
      result = left.contentLength - right.contentLength;
      break;
    case "visibility":
      result = Number(left.isVisible) - Number(right.isVisible);
      break;
  }

  if (result === 0) {
    result = left.title.localeCompare(right.title, undefined, { sensitivity: "base", numeric: true });
  }
  if (result === 0) {
    result = left.updatedAtMs - right.updatedAtMs;
  }

  return sortDirection === "asc" ? result : -result;
}
