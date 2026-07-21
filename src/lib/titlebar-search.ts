import type { Project, ProjectCommand, ProjectFlow } from "./api";
import { noteExcerpt, noteTitle, projectNoteVisibilityKey } from "./project-notes";
import type { ProjectNote } from "../components/project-detail-types";

export type TitlebarProjectSearchItem = {
  id: string;
  kind: "project";
  projectId: number;
  title: string;
  subtitle: string;
  avatarPath: string | null;
  path: string;
  description: string;
};

export type TitlebarCommandSearchItem = {
  id: string;
  kind: "command";
  projectId: number;
  commandId: number;
  title: string;
  subtitle: string;
  avatarPath: string | null;
  projectName: string;
  section: string;
  script: string;
};

export type TitlebarNoteSearchItem = {
  id: string;
  kind: "note";
  projectId: number;
  noteId: string;
  title: string;
  subtitle: string;
  projectName: string;
  excerpt: string;
  content: string;
  pinned: boolean;
  hidden: boolean;
};

export type TitlebarFlowSearchItem = {
  id: string;
  kind: "flow";
  projectId: number;
  flowId: number;
  title: string;
  subtitle: string;
  projectName: string;
  nodeCount: number;
};

export type TitlebarSearchItem =
  | TitlebarProjectSearchItem
  | TitlebarCommandSearchItem
  | TitlebarNoteSearchItem
  | TitlebarFlowSearchItem;

export type TitlebarSearchCollections = {
  projects: TitlebarProjectSearchItem[];
  commands: TitlebarCommandSearchItem[];
  notes: TitlebarNoteSearchItem[];
  flows: TitlebarFlowSearchItem[];
};

export function buildTitlebarSearchCollections({
  projects,
  commandsByProjectId,
  flowsByProjectId,
  notesByProjectId,
  noteVisibility,
}: {
  projects: Project[];
  commandsByProjectId: Record<number, ProjectCommand[]>;
  flowsByProjectId: Record<number, ProjectFlow[]>;
  notesByProjectId: Record<number, ProjectNote[]>;
  noteVisibility: Record<string, boolean>;
}): TitlebarSearchCollections {
  const projectItems = projects.map<TitlebarProjectSearchItem>((project) => ({
    id: `project:${project.id}`,
    kind: "project",
    projectId: project.id,
    title: project.name,
    subtitle: project.path,
    avatarPath: project.avatar_path,
    path: project.path,
    description: project.description?.trim() ?? "",
  }));

  const commandItems = projects.flatMap<TitlebarCommandSearchItem>((project) =>
    (commandsByProjectId[project.id] ?? []).map((command) => ({
      id: `command:${command.id}`,
      kind: "command",
      projectId: project.id,
      commandId: command.id,
      title: command.name,
      subtitle: `${project.name}${command.section ? ` • ${command.section}` : ""}`,
      avatarPath: command.avatar_path,
      projectName: project.name,
      section: command.section,
      script: command.script,
    })),
  );

  const noteItems = projects.flatMap<TitlebarNoteSearchItem>((project) =>
    (notesByProjectId[project.id] ?? []).map((note) => ({
      id: `note:${project.id}:${note.id}`,
      kind: "note",
      projectId: project.id,
      noteId: note.id,
      title: noteTitle(note, "Untitled note"),
      subtitle: project.name,
      projectName: project.name,
      excerpt: noteExcerpt(note.content),
      content: note.content,
      pinned: note.pinned,
      hidden: !(noteVisibility[projectNoteVisibilityKey(project.id, note.id)] ?? true),
    })),
  );

  const flowItems = projects.flatMap<TitlebarFlowSearchItem>((project) =>
    (flowsByProjectId[project.id] ?? []).map((flow) => ({
      id: `flow:${flow.id}`,
      kind: "flow",
      projectId: project.id,
      flowId: flow.id,
      title: flow.name,
      subtitle: `${project.name} • ${flow.node_count ?? 0} command nodes`,
      projectName: project.name,
      nodeCount: flow.node_count ?? 0,
    })),
  );

  return {
    projects: projectItems,
    commands: commandItems,
    notes: noteItems,
    flows: flowItems,
  };
}
