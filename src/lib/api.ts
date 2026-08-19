import { invoke } from "@tauri-apps/api/core";
import { normalizeCommandScript } from "./command-utils";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "./interactive-terminal";
import { parseProjectNotes, serializeProjectNotes } from "./project-notes";

const BROWSER_PREVIEW_ONLY_MESSAGE = "This action is only available in the desktop app.";
const BROWSER_MOCK_STORAGE_KEY = "projects-runner:browser-mock-data";
const BROWSER_MOCK_QUERY_PARAM = "browserMockDataUrl";
const BROWSER_MOCK_WINDOW_NAME_PREFIX = "projects-runner:browser-mock:";
const BROWSER_MOCK_SCRIPT_ID = "projects-runner-browser-mock";

export function isDesktopRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as typeof window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__?.invoke === "function";
}

type BrowserMockPayload = {
  projects: Project[];
  commandsByProjectId: Record<number, ProjectCommand[]>;
};

function normalizeProject(project: Project): Project {
  if (!project.notes) {
    return project;
  }

  const normalizedNotes = parseProjectNotes(project.notes);
  return {
    ...project,
    notes: serializeProjectNotes(normalizedNotes),
  };
}

function normalizeCommand(command: ProjectCommand): ProjectCommand {
  return {
    ...command,
    script: normalizeCommandScript(command.script),
    external_terminal_kind: command.external_terminal_kind ?? "default",
    interactive_terminal_kind: command.interactive_terminal_kind ?? "powershell",
    run_count: Number.isFinite(command.run_count) ? command.run_count : 0,
  };
}

function normalizeBrowserMockPayload(payload: BrowserMockPayload): BrowserMockPayload {
  return {
    projects: payload.projects.map(normalizeProject),
    commandsByProjectId: Object.fromEntries(
      Object.entries(payload.commandsByProjectId).map(([projectId, commands]) => [
        Number(projectId),
        commands.map(normalizeCommand),
      ]),
    ) as Record<number, ProjectCommand[]>,
  };
}

let browserMockPayloadPromise: Promise<BrowserMockPayload | null> | null = null;

function readBrowserMockPayload(): BrowserMockPayload | null {
  if (typeof window === "undefined" || isDesktopRuntime()) {
    return null;
  }

  const inlineScript = window.document?.getElementById(BROWSER_MOCK_SCRIPT_ID);
  if (inlineScript?.textContent) {
    try {
      const parsed = JSON.parse(inlineScript.textContent) as Partial<BrowserMockPayload>;
      if (Array.isArray(parsed.projects) && typeof parsed.commandsByProjectId === "object" && parsed.commandsByProjectId) {
        return {
          ...normalizeBrowserMockPayload({
            projects: parsed.projects,
            commandsByProjectId: parsed.commandsByProjectId as Record<number, ProjectCommand[]>,
          }),
        };
      }
    } catch {
      // Fall through to other browser mock sources.
    }
  }

  if (typeof window.name === "string" && window.name.startsWith(BROWSER_MOCK_WINDOW_NAME_PREFIX)) {
    try {
      const parsed = JSON.parse(window.name.slice(BROWSER_MOCK_WINDOW_NAME_PREFIX.length)) as Partial<BrowserMockPayload>;
      if (Array.isArray(parsed.projects) && typeof parsed.commandsByProjectId === "object" && parsed.commandsByProjectId) {
        return {
          ...normalizeBrowserMockPayload({
            projects: parsed.projects,
            commandsByProjectId: parsed.commandsByProjectId as Record<number, ProjectCommand[]>,
          }),
        };
      }
    } catch {
      // Fall through to other browser mock sources.
    }
  }

  try {
    const raw = window.localStorage.getItem(BROWSER_MOCK_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserMockPayload>;
    if (!Array.isArray(parsed.projects) || typeof parsed.commandsByProjectId !== "object" || !parsed.commandsByProjectId) {
      return null;
    }

    return {
      ...normalizeBrowserMockPayload({
        projects: parsed.projects,
        commandsByProjectId: parsed.commandsByProjectId as Record<number, ProjectCommand[]>,
      }),
    };
  } catch {
    return null;
  }
}

function readBrowserMockUrl() {
  if (typeof window === "undefined" || isDesktopRuntime()) {
    return null;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get(BROWSER_MOCK_QUERY_PARAM)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readBrowserMockPayloadAsync(): Promise<BrowserMockPayload | null> {
  const inlinePayload = readBrowserMockPayload();
  if (inlinePayload) {
    return inlinePayload;
  }

  const mockUrl = readBrowserMockUrl();
  if (!mockUrl) {
    return null;
  }

  if (!browserMockPayloadPromise) {
    browserMockPayloadPromise = fetch(mockUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load browser mock data from ${mockUrl}`);
        }

        const parsed = (await response.json()) as Partial<BrowserMockPayload>;
        if (!Array.isArray(parsed.projects) || typeof parsed.commandsByProjectId !== "object" || !parsed.commandsByProjectId) {
          throw new Error("Browser mock data is malformed.");
        }

        return {
          ...normalizeBrowserMockPayload({
            projects: parsed.projects,
            commandsByProjectId: parsed.commandsByProjectId as Record<number, ProjectCommand[]>,
          }),
        };
      })
      .catch(() => null);
  }

  return browserMockPayloadPromise;
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopRuntime()) {
    throw new Error(BROWSER_PREVIEW_ONLY_MESSAGE);
  }

  return invoke<T>(command, args);
}

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

export type CommandRuntimeMode = "internal_headless" | "internal_interactive" | "external_terminal";
export type ExternalTerminalKind = "default" | "windows_terminal" | "powershell" | "command_prompt" | "terminal_app";

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
  runtime_mode: CommandRuntimeMode;
  run_in_external_terminal: boolean;
  external_terminal_kind: ExternalTerminalKind;
  interactive_terminal_kind: InteractiveTerminalKind;
  run_count: number;
};

export type ProjectCommandSection = {
  id: number;
  project_id: number;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type CommandRun = {
  id: number;
  command_id: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  flow_node_id: string | null;
};

export type FlowNodeRunStart = {
  run: CommandRun;
  interactive_session: InteractiveSession | null;
};

export type ProjectFlow = {
  id: number;
  project_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  node_count?: number;
};

export type FlowNode = {
  id: string;
  flow_id: number;
  command_id: number;
  position_x: number;
  position_y: number;
};

export type FlowEdge = {
  id: string;
  flow_id: number;
  source_node_id: string;
  target_node_id: string;
};

export type FlowDetail = { flow: ProjectFlow; nodes: FlowNode[]; edges: FlowEdge[] };
export type ProjectFileEntry = {
  name: string;
  relative_path: string;
  is_directory: boolean;
  size_bytes: number;
  child_file_count: number;
  child_folder_count: number;
  created_at: string | null;
  modified_at: string | null;
  file_kind: "folder" | "text" | "binary";
  line_count: number | null;
};

export type ProjectFilePage = { entries: ProjectFileEntry[]; has_more: boolean };
export type ProjectFileContent = { file_kind: "text" | "image"; content: string | null; data_url: string | null };
export type DevProjectType = { id: string; label: string; category: string; description: string };
export type DevProjectTypeScan = { detected_type_ids: string[]; evidence: Record<string, string[]> };
export type DevCacheCandidate = { id: string; relative_path: string; size_bytes: number; file_count: number; project_type_ids: string[] };
export type DevCacheCleanFailure = { id: string; relative_path: string; error: string };
export type DevCacheCleanResult = { deleted_ids: string[]; failed_items: DevCacheCleanFailure[]; freed_bytes: number };
export type FlowGraphInput = {
  name: string;
  nodes: Array<Pick<FlowNode, "id" | "command_id" | "position_x" | "position_y">>;
  edges: Array<Pick<FlowEdge, "id" | "source_node_id" | "target_node_id">>;
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
  runtime_mode?: CommandRuntimeMode;
  run_in_external_terminal?: boolean;
  external_terminal_kind?: ExternalTerminalKind | null;
  interactive_terminal_kind?: InteractiveTerminalKind | null;
};

export type CommandSectionInput = {
  project_id: number;
  name: string;
  order_index?: number | null;
};

export type AppInfo = {
  name: string;
  version: string;
};

export type AppUpdateInfo = {
  currentVersion: string;
  version: string;
  assetName: string;
  assetSize: number;
  installAction: "install" | "reveal";
};

export type UpdateCheckResult = {
  update: AppUpdateInfo | null;
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
  runtime_mode: CommandRuntimeMode;
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
  title: string;
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

export type StopCommandResult = {
  was_active: boolean;
};

export type InteractiveSession = {
  session_id: string;
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  cols: number;
  rows: number;
  started_at: string;
};

export type InteractiveSessionExitedPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  exit_code: number | null;
  ended_at: string;
  status: string;
};

export type InteractiveSessionDataPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  data: string;
};

export type InteractiveSessionErrorPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  error: string;
};

export type RunStartedPayload = {
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  started_at: string;
};

export type RunOutputPayload = {
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  line: string;
};

export type RunFinishedPayload = {
  run_id: number;
  command_id: number;
  flow_node_id: string | null;
  status: string;
  exit_code: number | null;
  ended_at: string;
};

export const api = {
  listProjects: () => {
    if (isDesktopRuntime()) {
      return invokeDesktop<Project[]>("list_projects");
    }

    return readBrowserMockPayloadAsync().then((payload) => payload?.projects ?? []);
  },
  createProject: (input: ProjectInput) =>
    invokeDesktop<Project>("create_project", { input }),
  updateProject: (id: number, input: ProjectInput) =>
    invokeDesktop<Project>("update_project", { id, input }),
  deleteProject: (id: number) => invokeDesktop<void>("delete_project", { id }),
  listProjectFiles: (projectId: number, relativePath = "") =>
    invokeDesktop<ProjectFileEntry[]>("list_project_files", { projectId, relativePath }),
  listProjectFilesPage: (projectId: number, relativePath = "", offset = 0, limit = 64) =>
    invokeDesktop<ProjectFilePage>("list_project_files_page", { projectId, relativePath, offset, limit }),
  getProjectFileInfo: (projectId: number, relativePath = "") =>
    invokeDesktop<ProjectFileEntry>("get_project_file_info", { projectId, relativePath }),
  projectFileExists: (projectId: number, relativePath: string) =>
    invokeDesktop<boolean>("project_file_exists", { projectId, relativePath }),
  listDevProjectTypes: () => invokeDesktop<DevProjectType[]>("list_dev_project_types"),
  scanDevProjectTypes: (projectId: number, relativePath: string) =>
    invokeDesktop<DevProjectTypeScan>("scan_dev_project_types", { projectId, relativePath }),
  getFolderDevProjectTypes: (projectId: number, relativePath: string) =>
    invokeDesktop<string[]>("get_folder_dev_project_types", { projectId, relativePath }),
  setFolderDevProjectTypes: (projectId: number, relativePath: string, projectTypeIds: string[]) =>
    invokeDesktop<string[]>("set_folder_dev_project_types", { projectId, relativePath, projectTypeIds }),
  scanDevCache: (projectId: number, relativePath: string) =>
    invokeDesktop<DevCacheCandidate[]>("scan_dev_cache", { projectId, relativePath }),
  cleanDevCache: (projectId: number, relativePath: string, candidateIds: string[]) =>
    invokeDesktop<DevCacheCleanResult>("clean_dev_cache", { projectId, relativePath, candidateIds }),
  createProjectFile: (projectId: number, parentRelativePath: string, name: string) =>
    invokeDesktop<void>("create_project_file", { projectId, parentRelativePath, name }),
  createProjectFolder: (projectId: number, parentRelativePath: string, name: string) =>
    invokeDesktop<void>("create_project_folder", { projectId, parentRelativePath, name }),
  pasteProjectFile: (projectId: number, sourceRelativePath: string, targetRelativePath: string, cut: boolean) =>
    invokeDesktop<void>("paste_project_file", { projectId, sourceRelativePath, targetRelativePath, cut }),
  renameProjectFile: (projectId: number, relativePath: string, name: string) =>
    invokeDesktop<void>("rename_project_file", { projectId, relativePath, name }),
  deleteProjectFile: (projectId: number, relativePath: string) =>
    invokeDesktop<void>("delete_project_file", { projectId, relativePath }),
  revealProjectFile: (projectId: number, relativePath: string) =>
    invokeDesktop<void>("reveal_project_file", { projectId, relativePath }),
  openProjectFile: (projectId: number, relativePath: string) =>
    invokeDesktop<void>("open_project_file", { projectId, relativePath }),
  readProjectFile: (projectId: number, relativePath: string) =>
    invokeDesktop<ProjectFileContent>("read_project_file", { projectId, relativePath }),
  listCommands: (projectId: number) =>
    isDesktopRuntime()
      ? invokeDesktop<ProjectCommand[]>("list_commands", { projectId })
      : readBrowserMockPayloadAsync().then((payload) => payload?.commandsByProjectId[projectId] ?? []),
  listCommandSections: (projectId: number) =>
    isDesktopRuntime()
      ? invokeDesktop<ProjectCommandSection[]>("list_command_sections", { projectId })
      : readBrowserMockPayloadAsync().then((payload) => {
          const names = Array.from(
            new Set((payload?.commandsByProjectId[projectId] ?? []).map((command) => command.section || "General")),
          );
          return (names.length ? names : ["General"]).map((name, index) => ({
            id: -(projectId * 1000 + index + 1),
            project_id: projectId,
            name,
            order_index: index,
            created_at: "",
            updated_at: "",
          }));
        }),
  createCommandSection: (input: CommandSectionInput) =>
    invokeDesktop<ProjectCommandSection>("create_command_section", { input }),
  renameCommandSection: (id: number, name: string) =>
    invokeDesktop<ProjectCommandSection>("rename_command_section", { id, input: { name } }),
  deleteCommandSection: (id: number) => invokeDesktop<void>("delete_command_section", { id }),
  listFlows: (projectId: number) => invokeDesktop<ProjectFlow[]>("list_flows", { projectId }),
  getFlow: (id: number) => invokeDesktop<FlowDetail>("get_flow", { id }),
  createFlow: (projectId: number, name: string) => invokeDesktop<ProjectFlow>("create_flow", { input: { project_id: projectId, name } }),
  updateFlow: (id: number, name: string) => invokeDesktop<ProjectFlow>("update_flow", { id, input: { name } }),
  saveFlowGraph: (id: number, input: FlowGraphInput) => invokeDesktop<FlowDetail>("save_flow_graph", { id, input }),
  deleteFlow: (id: number) => invokeDesktop<void>("delete_flow", { id }),
  startFlowNode: (flowId: number, flowNodeId: string, cols = 120, rows = 32) =>
    invokeDesktop<FlowNodeRunStart>("start_flow_node", { flowId, flowNodeId, cols, rows }),
  createCommand: (input: CommandInput) =>
    invokeDesktop<ProjectCommand>("create_command", { input }),
  updateCommand: (id: number, input: CommandInput) =>
    invokeDesktop<ProjectCommand>("update_command", { id, input }),
  deleteCommand: (id: number) => invokeDesktop<void>("delete_command", { id }),
  runCommand: (commandId: number) =>
    invokeDesktop<CommandRun>("run_command", { commandId }),
  restartCommand: (commandId: number) =>
    invokeDesktop<CommandRun>("restart_command", { commandId }),
  stopCommand: (runId: number) => invokeDesktop<StopCommandResult>("stop_command", { runId }),
  startInteractiveCommand: (commandId: number, cols: number, rows: number) =>
    invokeDesktop<InteractiveSession>("start_interactive_command", { commandId, cols, rows }),
  startProjectInteractiveTerminal: (projectPath: string, terminalId: number, terminalKind: InteractiveTerminalKind, cols: number, rows: number) =>
    invokeDesktop<InteractiveSession>("start_project_interactive_terminal", { projectPath, terminalId, terminalKind, cols, rows }),
  writeInteractiveTerminal: (sessionId: string, data: string) =>
    invokeDesktop<void>("write_interactive_terminal", { sessionId, data }),
  resizeInteractiveTerminal: (sessionId: string, cols: number, rows: number) =>
    invokeDesktop<void>("resize_interactive_terminal", { sessionId, cols, rows }),
  stopInteractiveCommand: (sessionId: string) =>
    invokeDesktop<StopCommandResult>("stop_interactive_command", { sessionId }),
  restartInteractiveCommand: (commandId: number, cols: number, rows: number) =>
    invokeDesktop<InteractiveSession>("restart_interactive_command", { commandId, cols, rows }),
  listInteractiveTerminalOptions: () =>
    invokeDesktop<InteractiveTerminalOption[]>("list_interactive_terminal_options"),
  killPorts: (ports: number[]) => invokeDesktop<void>("kill_ports", { ports }),
  getPortsProcesses: (ports: number[]) => invokeDesktop<PortProcess[]>("get_ports_processes", { ports }),
  killProcesses: (pids: number[]) => invokeDesktop<void>("kill_processes", { pids }),
  appInfo: () =>
    (isDesktopRuntime()
      ? invokeDesktop<AppInfo>("app_info")
      : readBrowserMockPayloadAsync().then((payload) => ({
          name: "Projects Runner",
          version: payload ? "Browser Preview (Mock Data)" : "Browser Preview",
        }))),
  checkForUpdate: () => invokeDesktop<UpdateCheckResult>("check_for_update"),
  downloadUpdate: () => invokeDesktop<string>("download_update"),
  installDownloadedUpdate: () => invokeDesktop<void>("install_downloaded_update"),
  revealDownloadedUpdate: () => invokeDesktop<void>("reveal_downloaded_update"),
  exportProject: (projectId: number) =>
    invokeDesktop<string | null>("export_project", { projectId }),
  pickPrdFile: () => invokeDesktop<ImportPreview | null>("pick_prd_file"),
  analyzePrdFile: (filePath: string) =>
    invokeDesktop<PrdImportAnalysis>("analyze_prd_file", { filePath }),
  importPrdFile: (filePath: string) =>
    invokeDesktop<Project>("import_prd_file", { filePath }),
  applyPrdImport: (request: ApplyPrdImportRequest) =>
    invokeDesktop<Project>("apply_prd_import", { request }),
  pickProjectFolder: () => invokeDesktop<string | null>("pick_project_folder"),
  pickAndCopyAvatar: (kind: "project" | "command", ownerId?: number) =>
    invokeDesktop<string | null>("pick_and_copy_avatar", {
      kind,
      ownerId: ownerId ?? null,
    }),
  showProjectInExplorer: (path: string) => invokeDesktop<void>("show_project_in_explorer", { path }),
  openInExternalTerminal: (path: string) => invokeDesktop<void>("open_in_external_terminal", { path }),
  takePendingPrdOpenRequests: () =>
    (isDesktopRuntime()
      ? invokeDesktop<string[]>("take_pending_prd_open_requests")
      : Promise.resolve([])),
};
