import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizeCommandScript } from "./command-utils";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "./interactive-terminal";
import { parseProjectNotes, serializeProjectNotes } from "./project-notes";
export type * from "../types/generated/twofa";
export type * from "../types/generated/terminal";
import type {
  TwofaVaultStatus,
  TwofaVaultSettings,
  TwofaAccountSummary,
  TwofaAccountInput,
  TwofaAccountSecretPayload,
  TwofaCodeBatch,
  TwofaCopyResult,
  TwofaScanScreenResult,
  TwofaImportPreview,
  CommitImportItemSelection,
  TwofaImportCommitResult,
  ProjectDelete2faPreview,
  TwofaSecurityError,
} from "../types/generated/twofa";
import type {
  InteractiveSessionInfo,
  TerminalChannelEvent,
} from "../types/generated/terminal";

export type TwofaCopyCodeResult = TwofaCopyResult;
export type InteractiveSession = InteractiveSessionInfo;

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

export class TwofaApiError extends Error {
  code: string;
  details: string | null;

  constructor(code: string, message: string, details?: string | null) {
    super(message);
    this.name = "TwofaApiError";
    this.code = code;
    this.details = details ?? null;
  }
}

export function parseTwofaSecurityError(err: unknown): TwofaSecurityError {
  if (err instanceof TwofaApiError) {
    return {
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    const obj = err as Record<string, unknown>;
    return {
      code: String(obj.code),
      message: String(obj.message),
      details: typeof obj.details === "string" ? obj.details : null,
    };
  }
  const rawMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
  if (rawMsg.includes(": ")) {
    const idx = rawMsg.indexOf(": ");
    const code = rawMsg.slice(0, idx).trim();
    const rest = rawMsg.slice(idx + 2).trim();
    return {
      code,
      message: rest,
      details: null,
    };
  }
  return {
    code: "UNKNOWN",
    message: rawMsg,
    details: null,
  };
}

async function invokeTwofa<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invokeDesktop<T>(command, args);
  } catch (err) {
    const parsed = parseTwofaSecurityError(err);
    throw new TwofaApiError(parsed.code, parsed.message, parsed.details);
  }
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
};

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
export type DevCacheCandidate = { id: string; relative_path: string; size_bytes: number; file_count: number; project_type_ids: string[]; is_dependency?: boolean };
export type DevCacheCleanFailure = { id: string; relative_path: string; error: string };
export type DevCacheCleanResult = { deleted_ids: string[]; failed_items: DevCacheCleanFailure[]; freed_bytes: number };

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

export type InteractiveSessionExitedPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  exit_code: number | null;
  ended_at: string;
  status: string;
};

export type InteractiveSessionDataPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  data: string;
};

export type InteractiveSessionErrorPayload = {
  session_id: string;
  run_id: number;
  command_id: number;
  error: string;
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
  deleteProject: (id: number, deleteExclusive2fa?: boolean) =>
    invokeDesktop<void>("delete_project", { id, deleteExclusive2fa: deleteExclusive2fa ?? false }),
  listProjectFiles: (projectId: number, relativePath = "") =>
    invokeDesktop<ProjectFileEntry[]>("list_project_files", { projectId, relativePath }),
  listProjectFilesPage: (projectId: number, relativePath = "", offset = 0, limit = 64) =>
    invokeDesktop<ProjectFilePage>("list_project_files_page", { projectId, relativePath, offset, limit }),
  getProjectFileInfo: (projectId: number, relativePath = "") =>
    invokeDesktop<ProjectFileEntry>("get_project_file_info", { projectId, relativePath }),
  getProjectFolderSize: (projectId: number, relativePath = "") =>
    invokeDesktop<number>("get_project_folder_size", { projectId, relativePath }),
  projectFileExists: (projectId: number, relativePath: string) =>
    invokeDesktop<boolean>("project_file_exists", { projectId, relativePath }),
  listDevProjectTypes: () => invokeDesktop<DevProjectType[]>("list_dev_project_types"),
  scanDevProjectTypes: (projectId: number, relativePath: string) =>
    invokeDesktop<DevProjectTypeScan>("scan_dev_project_types", { projectId, relativePath }),
  getFolderDevProjectTypes: (projectId: number, relativePath: string) =>
    invokeDesktop<string[]>("get_folder_dev_project_types", { projectId, relativePath }),
  listAllFolderDevProjectTypes: (projectId: number) =>
    isDesktopRuntime()
      ? invokeDesktop<Record<string, string[]>>("list_all_folder_dev_project_types", { projectId })
      : Promise.resolve<Record<string, string[]>>({}),
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
  twofaGetStatus: () => invokeTwofa<TwofaVaultStatus>("twofa_get_status"),
  twofaSetupVault: (
    password: string,
    lockEnabled: boolean,
    pin?: string | null,
    settings?: TwofaVaultSettings | null,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_setup_vault", {
      password,
      lockEnabled,
      pin: pin ?? null,
      settings: settings ?? null,
    }),
  twofaUnlockVault: (password: string, operationId?: string | null) =>
    invokeTwofa<TwofaVaultStatus>("twofa_unlock_vault", { password, operationId: operationId ?? null }),
  twofaTryAutoUnlock: () =>
    invokeTwofa<TwofaVaultStatus>("twofa_try_auto_unlock"),
  twofaUnlockWithPin: (pin: string, operationId?: string | null) =>
    invokeTwofa<TwofaVaultStatus>("twofa_unlock_with_pin", { pin, operationId: operationId ?? null }),
  twofaCancelAuth: (operationId: string) =>
    invokeTwofa<void>("twofa_cancel_auth", { operationId }),
  twofaCleanupSetup: () =>
    invokeTwofa<TwofaVaultStatus>("twofa_cleanup_setup"),
  twofaLockVault: () => invokeTwofa<TwofaVaultStatus>("twofa_lock_vault"),
  twofaSetLockEnabled: (
    lockEnabled: boolean,
    masterPassword: string,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_set_lock_enabled", {
      lockEnabled,
      masterPassword,
      expectedSessionId,
      expectedRevision,
    }),
  twofaSetPin: (
    pin: string,
    masterPassword: string,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_set_pin", {
      pin,
      masterPassword,
      expectedSessionId,
      expectedRevision,
    }),
  twofaRemovePin: (
    masterPassword: string,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_remove_pin", {
      masterPassword,
      expectedSessionId,
      expectedRevision,
    }),
  twofaChangePassword: (
    oldPassword: string,
    newPassword: string,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_change_password", {
      oldPassword,
      newPassword,
      expectedSessionId,
      expectedRevision,
    }),
  twofaUpdateSettings: (
    settings: TwofaVaultSettings,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_update_settings", {
      settings,
      expectedSessionId,
      expectedRevision,
    }),
  twofaRetryRecovery: (
    masterPassword: string,
    expectedSessionId: string,
    expectedRevision: number,
  ) =>
    invokeTwofa<TwofaVaultStatus>("twofa_retry_recovery", {
      masterPassword,
      expectedSessionId,
      expectedRevision,
    }),
  twofaTouchActivity: (expectedSessionId: string) =>
    invokeTwofa<void>("twofa_touch_activity", { expectedSessionId }),
  twofaListAccounts: (expectedSessionId: string, projectId?: number, unassignedOnly?: boolean, search?: string) =>
    invokeTwofa<TwofaAccountSummary[]>("twofa_list_accounts", {
      expectedSessionId,
      projectId: projectId ?? null,
      unassignedOnly: unassignedOnly ?? false,
      search: search ?? null,
    }),
  twofaGetCodes: (expectedSessionId: string, accountIds?: string[]) =>
    invokeTwofa<TwofaCodeBatch>("twofa_get_codes", { expectedSessionId, accountIds: accountIds ?? null }),
  twofaCreateAccount: (input: TwofaAccountInput, expectedSessionId: string) =>
    invokeTwofa<TwofaAccountSummary>("twofa_create_account", { input, expectedSessionId }),
  twofaUpdateAccount: (id: string, input: TwofaAccountInput, expectedSessionId: string) =>
    invokeTwofa<TwofaAccountSummary>("twofa_update_account", { id, input, expectedSessionId }),
  twofaDeleteAccount: (id: string, expectedSessionId: string) =>
    invokeTwofa<void>("twofa_delete_account", { id, expectedSessionId }),
  twofaGetAccountSecret: (id: string, expectedSessionId: string) =>
    invokeTwofa<TwofaAccountSecretPayload>("twofa_get_account_secret", { id, expectedSessionId }),
  twofaGetAccountQr: (id: string, expectedSessionId: string) =>
    invokeTwofa<string>("twofa_get_account_qr", { id, expectedSessionId }),
  twofaSaveQrPng: (id: string, expectedSessionId: string) =>
    invokeTwofa<boolean>("twofa_save_qr_png", {
      id,
      expectedSessionId,
    }),
  twofaCopyCode: (accountId: string, expectedSessionId: string) =>
    invokeTwofa<TwofaCopyCodeResult>("twofa_copy_code", {
      accountId,
      expectedSessionId,
    }),
  twofaScanScreenQr: (expectedSessionId: string) =>
    invokeTwofa<TwofaScanScreenResult>("twofa_scan_screen_qr", {
      expectedSessionId,
    }),
  twofaScanImageQr: (imageDataBase64: string, expectedSessionId: string) =>
    invokeTwofa<TwofaAccountSecretPayload[]>("twofa_scan_image_qr", {
      imageDataBase64,
      expectedSessionId,
    }),
  twofaPickAndScanImageQr: (expectedSessionId: string) =>
    invokeTwofa<TwofaAccountSecretPayload[]>("twofa_pick_and_scan_image_qr", {
      expectedSessionId,
    }),
  twofaPreviewImport: (uris: string[], expectedSessionId: string) =>
    invokeTwofa<TwofaImportPreview>("twofa_preview_import", {
      uris,
      expectedSessionId,
    }),
  twofaPreviewImportFromImage: (imageDataBase64: string, expectedSessionId: string) =>
    invokeTwofa<TwofaImportPreview>("twofa_preview_import_from_image", {
      imageDataBase64,
      expectedSessionId,
    }),
  twofaPreviewImportFromImageDialog: (expectedSessionId: string) =>
    invokeTwofa<TwofaImportPreview>("twofa_preview_import_from_image_dialog", {
      expectedSessionId,
    }),
  twofaPreviewImportFromScreen: (expectedSessionId: string) =>
    invokeTwofa<TwofaImportPreview>("twofa_preview_import_from_screen", {
      expectedSessionId,
    }),
  twofaCancelImportPreview: (previewId: string, expectedSessionId: string) =>
    invokeTwofa<void>("twofa_cancel_import_preview", {
      previewId,
      expectedSessionId,
    }),
  twofaImportAccounts: (
    previewId: string,
    selections: CommitImportItemSelection[],
    expectedSessionId: string,
  ) =>
    invokeTwofa<TwofaImportCommitResult>("twofa_import_accounts", {
      previewId,
      selections,
      expectedSessionId,
    }),
  twofaExportPlaintext: (expectedSessionId: string) =>
    invokeTwofa<boolean>("twofa_export_plaintext", {
      expectedSessionId,
    }),
  twofaExportEncryptedBackup: (password: string, expectedSessionId: string) =>
    invokeTwofa<boolean>("twofa_export_encrypted_backup", {
      password,
      expectedSessionId,
    }),
  twofaImportEncryptedBackup: (
    backupContent: string,
    password: string,
    expectedSessionId: string,
  ) =>
    invokeTwofa<TwofaImportPreview>("twofa_import_encrypted_backup", {
      backupContent,
      password,
      expectedSessionId,
    }),
  twofaPreviewProjectDeletion: (projectId: number) =>
    invokeTwofa<ProjectDelete2faPreview>("twofa_preview_project_deletion", { projectId }),
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
  startInteractiveCommand: (
    commandId: number,
    cols: number,
    rows: number,
    onEvent?: Channel<TerminalChannelEvent>,
  ) =>
    invokeDesktop<InteractiveSessionInfo>("start_interactive_command", { commandId, cols, rows, onEvent }),
  startProjectInteractiveTerminal: (
    projectPath: string,
    terminalId: number,
    terminalKind: InteractiveTerminalKind,
    cols: number,
    rows: number,
    onEvent?: Channel<TerminalChannelEvent>,
  ) =>
    invokeDesktop<InteractiveSessionInfo>("start_project_interactive_terminal", {
      projectPath,
      terminalId,
      terminalKind,
      cols,
      rows,
      onEvent,
    }),
  ackTerminalOutput: (sessionId: string, generation: number, sequence: number, bytesProcessed: number) =>
    invokeDesktop<void>("ack_terminal_output", {
      payload: {
        session_id: sessionId,
        generation,
        sequence,
        bytes_processed: bytesProcessed,
      },
    }),
  writeInteractiveTerminal: (sessionId: string, data: string) =>
    invokeDesktop<void>("write_interactive_terminal", { sessionId, data }),
  resizeInteractiveTerminal: (sessionId: string, cols: number, rows: number) =>
    invokeDesktop<void>("resize_interactive_terminal", { sessionId, cols, rows }),
  stopInteractiveCommand: (sessionId: string) =>
    invokeDesktop<StopCommandResult>("stop_interactive_command", { sessionId }),
  restartInteractiveCommand: (
    commandId: number,
    cols: number,
    rows: number,
    onEvent?: Channel<TerminalChannelEvent>,
  ) =>
    invokeDesktop<InteractiveSessionInfo>("restart_interactive_command", { commandId, cols, rows, onEvent }),
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
