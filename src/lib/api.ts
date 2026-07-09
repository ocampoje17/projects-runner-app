import { invoke } from "@tauri-apps/api/core";

export type Project = {
  id: number;
  name: string;
  path: string;
  avatar_path: string | null;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCommand = {
  id: number;
  project_id: number;
  name: string;
  script: string;
  avatar_path: string | null;
  ports: string;
  section: string;
  order_index: number;
  created_at: string;
  updated_at: string;
  run_in_external_terminal: boolean;
};

export type CommandRun = {
  id: number;
  command_id: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
};

export type ProjectInput = {
  name: string;
  path: string;
  avatar_path?: string | null;
  description?: string | null;
  notes?: string | null;
};

export type CommandInput = {
  project_id: number;
  name: string;
  script: string;
  avatar_path?: string | null;
  ports?: number[] | null;
  section?: string | null;
  order_index?: number | null;
  run_in_external_terminal?: boolean;
};

export type AppInfo = {
  name: string;
  version: string;
};

export type ImportPreview = {
  file_path: string;
  project_name: string;
  project_path: string;
  description: string | null;
  command_count: number;
  sections: string[];
};

export type ExistingProjectSummary = {
  id: number;
  name: string;
  path: string;
  description: string | null;
  avatar_label: string | null;
  command_count: number;
  note_count: number;
};

export type ProjectFieldChange = {
  field: string;
  label: string;
  status: "new" | "overwrite";
  existing_value: string | null;
  incoming_value: string | null;
};

export type CommandPreview = {
  id: number | null;
  name: string;
  script: string;
  avatar_label: string | null;
  ports: number[];
  section: string;
  order_index: number;
  run_in_external_terminal: boolean;
};

export type CommandImportDiff = {
  index: number;
  status: "new" | "identical" | "overwrite";
  overwrite_fields: string[];
  matched_command_id: number | null;
  existing: CommandPreview | null;
  incoming: CommandPreview;
  default_selected: boolean;
};

export type ProjectNoteItem = {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NoteImportDiff = {
  index: number;
  status: "new" | "identical" | "overwrite";
  overwrite_fields: string[];
  matched_note_id: string | null;
  existing: ProjectNoteItem | null;
  incoming: ProjectNoteItem;
  default_selected: boolean;
};

export type PrdImportAnalysis = {
  analysis_signature: string;
  file_path: string;
  format: string;
  exported_at: string;
  project_name: string;
  project_path: string;
  description: string | null;
  sections: string[];
  existing_project: ExistingProjectSummary | null;
  project_field_changes: ProjectFieldChange[];
  command_diffs: CommandImportDiff[];
  note_diffs: NoteImportDiff[];
};

export type ApplyPrdImportRequest = {
  file_path: string;
  analysis_signature: string;
  target_project_id: number | null;
  selected_project_fields: string[];
  selected_command_indexes: number[];
  selected_note_indexes: number[];
  overwrite_confirmed: boolean;
};

export type PortProcess = {
  port: number;
  pid: number;
  name: string;
};

export type RunStartedPayload = {
  run_id: number;
  command_id: number;
  started_at: string;
};

export type RunOutputPayload = {
  run_id: number;
  command_id: number;
  line: string;
};

export type RunFinishedPayload = {
  run_id: number;
  command_id: number;
  status: string;
  exit_code: number | null;
  ended_at: string;
};

export const api = {
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (input: ProjectInput) =>
    invoke<Project>("create_project", { input }),
  updateProject: (id: number, input: ProjectInput) =>
    invoke<Project>("update_project", { id, input }),
  deleteProject: (id: number) => invoke<void>("delete_project", { id }),
  listCommands: (projectId: number) =>
    invoke<ProjectCommand[]>("list_commands", { projectId }),
  createCommand: (input: CommandInput) =>
    invoke<ProjectCommand>("create_command", { input }),
  updateCommand: (id: number, input: CommandInput) =>
    invoke<ProjectCommand>("update_command", { id, input }),
  deleteCommand: (id: number) => invoke<void>("delete_command", { id }),
  runCommand: (commandId: number) =>
    invoke<CommandRun>("run_command", { commandId }),
  stopCommand: (runId: number) => invoke<void>("stop_command", { runId }),
  killPorts: (ports: number[]) => invoke<void>("kill_ports", { ports }),
  getPortsProcesses: (ports: number[]) => invoke<PortProcess[]>("get_ports_processes", { ports }),
  killProcesses: (pids: number[]) => invoke<void>("kill_processes", { pids }),
  appInfo: () => invoke<AppInfo>("app_info"),
  exportProject: (projectId: number) =>
    invoke<string | null>("export_project", { projectId }),
  pickPrdFile: () => invoke<ImportPreview | null>("pick_prd_file"),
  analyzePrdFile: (filePath: string) =>
    invoke<PrdImportAnalysis>("analyze_prd_file", { filePath }),
  importPrdFile: (filePath: string) =>
    invoke<Project>("import_prd_file", { filePath }),
  applyPrdImport: (request: ApplyPrdImportRequest) =>
    invoke<Project>("apply_prd_import", { request }),
  pickProjectFolder: () => invoke<string | null>("pick_project_folder"),
  pickAndCopyAvatar: (kind: "project" | "command", ownerId?: number) =>
    invoke<string | null>("pick_and_copy_avatar", {
      kind,
      ownerId: ownerId ?? null,
    }),
  showProjectInExplorer: (path: string) => invoke<void>("show_project_in_explorer", { path }),
  openInExternalTerminal: (path: string) => invoke<void>("open_in_external_terminal", { path }),
  takePendingPrdOpenRequests: () =>
    invoke<string[]>("take_pending_prd_open_requests"),
};
