mod app_updates;
mod dev_cache;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Integer, Nullable, Text};
use diesel::sqlite::SqliteConnection;
use mime_guess::MimeGuess;
use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder as PtyCommandBuilder, MasterPty, PtySize,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
#[cfg(not(target_os = "windows"))]
use std::ffi::OsStr;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use dev_cache::{DevCacheCandidate, DevProjectType, DevProjectTypeScan};

const RUNTIME_MODE_INTERNAL_HEADLESS: &str = "internal_headless";
const RUNTIME_MODE_INTERNAL_INTERACTIVE: &str = "internal_interactive";
const RUNTIME_MODE_EXTERNAL_TERMINAL: &str = "external_terminal";
const EXTERNAL_TERMINAL_KIND_DEFAULT: &str = "default";
const EXTERNAL_TERMINAL_KIND_WINDOWS_TERMINAL: &str = "windows_terminal";
const EXTERNAL_TERMINAL_KIND_POWERSHELL: &str = "powershell";
const EXTERNAL_TERMINAL_KIND_COMMAND_PROMPT: &str = "command_prompt";
const INTERACTIVE_TERMINAL_KIND_CMD: &str = "cmd";
const INTERACTIVE_TERMINAL_KIND_BASH: &str = "bash";
const INTERACTIVE_TERMINAL_KIND_POWERSHELL: &str = "powershell";
const INTERACTIVE_TERMINAL_KIND_WSL2: &str = "wsl2";
const INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE: &str = "powershellcore";
#[cfg(target_os = "macos")]
const EXTERNAL_TERMINAL_KIND_TERMINAL_APP: &str = "terminal_app";

#[derive(Clone)]
struct AppPaths {
    db_path: PathBuf,
    avatars_dir: PathBuf,
    scripts_dir: PathBuf,
}

struct AppState {
    paths: AppPaths,
    processes: Mutex<HashMap<i64, Arc<RunProcess>>>,
    interactive_sessions: Mutex<HashMap<String, Arc<InteractiveSession>>>,
    interactive_sessions_by_command: Mutex<HashMap<i64, String>>,
    interactive_sessions_by_run: Mutex<HashMap<i64, String>>,
    stopped_runs: Mutex<HashSet<i64>>,
    pending_prd_open_requests: Mutex<Vec<String>>,
}

struct RunProcess {
    pid: u32,
    child: Mutex<Child>,
}

struct InteractiveSession {
    run_id: i64,
    pid: Option<u32>,
    lifecycle: AtomicU8,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

const INTERACTIVE_RUNNING: u8 = 1;
const INTERACTIVE_STOPPING: u8 = 2;
const INTERACTIVE_EXITED: u8 = 3;

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct Project {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    path: String,
    #[diesel(sql_type = Nullable<Text>)]
    avatar_path: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    description: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    notes: Option<String>,
    #[diesel(sql_type = Text)]
    created_at: String,
    #[diesel(sql_type = Text)]
    updated_at: String,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct ProjectCommand {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    project_id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    script: String,
    #[diesel(sql_type = Nullable<Text>)]
    avatar_path: Option<String>,
    #[diesel(sql_type = Text)]
    ports: String,
    #[diesel(sql_type = Text)]
    section: String,
    #[diesel(sql_type = Integer)]
    order_index: i32,
    #[diesel(sql_type = Text)]
    created_at: String,
    #[diesel(sql_type = Text)]
    updated_at: String,
    #[diesel(sql_type = Text)]
    runtime_mode: String,
    #[diesel(sql_type = Integer)]
    run_in_external_terminal: i32,
    #[diesel(sql_type = Text)]
    external_terminal_kind: String,
    #[diesel(sql_type = Text)]
    interactive_terminal_kind: String,
    #[diesel(sql_type = Integer)]
    run_count: i32,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct CommandSection {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    project_id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Integer)]
    order_index: i32,
    #[diesel(sql_type = Text)]
    created_at: String,
    #[diesel(sql_type = Text)]
    updated_at: String,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct CommandRun {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    command_id: i64,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = Text)]
    started_at: String,
    #[diesel(sql_type = Nullable<Text>)]
    ended_at: Option<String>,
    #[diesel(sql_type = Nullable<Integer>)]
    exit_code: Option<i32>,
    #[diesel(sql_type = Nullable<Text>)]
    flow_node_id: Option<String>,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct Flow {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    project_id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    created_at: String,
    #[diesel(sql_type = Text)]
    updated_at: String,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct FlowSummary {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    project_id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    created_at: String,
    #[diesel(sql_type = Text)]
    updated_at: String,
    #[diesel(sql_type = BigInt)]
    node_count: i64,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct FlowNode {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = BigInt)]
    flow_id: i64,
    #[diesel(sql_type = BigInt)]
    command_id: i64,
    #[diesel(sql_type = Integer)]
    position_x: i32,
    #[diesel(sql_type = Integer)]
    position_y: i32,
}

#[derive(Debug, Serialize, QueryableByName, Clone)]
struct FlowEdge {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = BigInt)]
    flow_id: i64,
    #[diesel(sql_type = Text)]
    source_node_id: String,
    #[diesel(sql_type = Text)]
    target_node_id: String,
}

#[derive(Debug, Serialize)]
struct FlowDetail {
    flow: Flow,
    nodes: Vec<FlowNode>,
    edges: Vec<FlowEdge>,
}

#[derive(Debug, Serialize)]
struct ProjectFileEntry {
    name: String,
    relative_path: String,
    is_directory: bool,
    size_bytes: u64,
    child_file_count: u64,
    child_folder_count: u64,
    created_at: Option<String>,
    modified_at: Option<String>,
    file_kind: String,
    line_count: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ProjectFilePage {
    entries: Vec<ProjectFileEntry>,
    has_more: bool,
}

#[derive(Debug, Serialize)]
struct ProjectFileContent {
    file_kind: String,
    content: Option<String>,
    data_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct DevCacheCleanFailure {
    id: String,
    relative_path: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct DevCacheCleanResult {
    deleted_ids: Vec<String>,
    failed_items: Vec<DevCacheCleanFailure>,
    freed_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct FlowInput {
    project_id: i64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct FlowUpdateInput {
    name: String,
}

#[derive(Debug, Deserialize)]
struct FlowGraphInput {
    name: String,
    nodes: Vec<FlowNodeInput>,
    edges: Vec<FlowEdgeInput>,
}

#[derive(Debug, Deserialize)]
struct FlowNodeInput {
    id: String,
    command_id: i64,
    position_x: i32,
    position_y: i32,
}

#[derive(Debug, Deserialize)]
struct FlowEdgeInput {
    id: String,
    source_node_id: String,
    target_node_id: String,
}

#[derive(Debug, Serialize)]
struct FlowNodeRunStart {
    run: CommandRun,
    interactive_session: Option<InteractiveSessionInfo>,
}

#[derive(Debug, Serialize, Clone)]
struct RunStartedPayload {
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    started_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct RunOutputPayload {
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    line: String,
}

#[derive(Debug, Serialize, Clone)]
struct RunFinishedPayload {
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    status: String,
    exit_code: Option<i32>,
    ended_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct InteractiveSessionInfo {
    session_id: String,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    cols: u16,
    rows: u16,
    started_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct InteractiveDataPayload {
    session_id: String,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
struct InteractiveExitPayload {
    session_id: String,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    exit_code: Option<i32>,
    ended_at: String,
    status: String,
}

#[derive(Debug, Serialize, Clone)]
struct InteractiveErrorPayload {
    session_id: String,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    error: String,
}

#[derive(Debug, Deserialize)]
struct ProjectInput {
    name: String,
    path: String,
    avatar_path: Option<String>,
    description: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommandInput {
    project_id: i64,
    name: String,
    script: String,
    avatar_path: Option<String>,
    ports: Option<Vec<u16>>,
    section: Option<String>,
    order_index: Option<i32>,
    runtime_mode: Option<String>,
    run_in_external_terminal: Option<bool>,
    external_terminal_kind: Option<String>,
    interactive_terminal_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommandSectionInput {
    project_id: i64,
    name: String,
    order_index: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct CommandSectionUpdateInput {
    name: String,
}

#[derive(Debug, Serialize)]
struct InteractiveTerminalOption {
    id: String,
    label: String,
    description: String,
}

static NEXT_AD_HOC_RUN_ID: AtomicI64 = AtomicI64::new(-1);

#[derive(Debug, Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

const LUCIDE_ICON_PREFIX: &str = "lucide:";
const PRD_V1_FORMAT: &str = "projects-runner.prd.v1";
const PRD_V2_FORMAT: &str = "projects-runner.prd.v2";
const PRD_OPEN_EVENT: &str = "prd://open-request";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectNoteItem {
    id: String,
    content: String,
    pinned: bool,
    #[serde(rename = "createdAt", alias = "created_at")]
    created_at: String,
    #[serde(rename = "updatedAt", alias = "updated_at")]
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyPrdProject {
    name: String,
    path: String,
    avatar_path: Option<String>,
    description: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyPrdCommand {
    name: String,
    script: String,
    avatar_path: Option<String>,
    ports: Vec<u16>,
    section: String,
    order_index: i32,
    runtime_mode: Option<String>,
    run_in_external_terminal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyPrdFile {
    format: String,
    exported_at: String,
    project: LegacyPrdProject,
    commands: Vec<LegacyPrdCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum PrdAvatarRef {
    Icon { value: String },
    Asset { asset_id: String },
    Path { value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrdAsset {
    id: String,
    file_name: String,
    mime_type: String,
    sha256: String,
    data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrdProjectV2 {
    name: String,
    path: String,
    avatar: Option<PrdAvatarRef>,
    description: Option<String>,
    notes: Vec<ProjectNoteItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrdCommandV2 {
    name: String,
    script: String,
    avatar: Option<PrdAvatarRef>,
    ports: Vec<u16>,
    section: String,
    order_index: i32,
    runtime_mode: String,
    run_in_external_terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrdFileV2 {
    format: String,
    exported_at: String,
    project: PrdProjectV2,
    commands: Vec<PrdCommandV2>,
    #[serde(default)]
    sections: Vec<String>,
    assets: Vec<PrdAsset>,
}

#[derive(Debug, Clone)]
struct NormalizedPrdProject {
    name: String,
    path: String,
    avatar: Option<PrdAvatarRef>,
    description: Option<String>,
    notes: Vec<ProjectNoteItem>,
}

#[derive(Debug, Clone)]
struct NormalizedPrdCommand {
    name: String,
    script: String,
    avatar: Option<PrdAvatarRef>,
    ports: Vec<u16>,
    section: String,
    order_index: i32,
    runtime_mode: String,
    run_in_external_terminal: bool,
}

#[derive(Debug, Clone)]
struct NormalizedPrdFile {
    format: String,
    exported_at: String,
    project: NormalizedPrdProject,
    commands: Vec<NormalizedPrdCommand>,
    sections: Vec<String>,
    assets: HashMap<String, PrdAsset>,
}

#[derive(Debug, Serialize)]
struct ImportPreview {
    file_path: String,
    project_name: String,
    project_path: String,
    description: Option<String>,
    command_count: usize,
    sections: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ExistingProjectSummary {
    id: i64,
    name: String,
    path: String,
    description: Option<String>,
    avatar_label: Option<String>,
    command_count: usize,
    note_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum ImportDiffStatus {
    New,
    Identical,
    Overwrite,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum ProjectFieldStatus {
    New,
    Overwrite,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectFieldChange {
    field: String,
    label: String,
    status: ProjectFieldStatus,
    existing_value: Option<String>,
    incoming_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct CommandPreview {
    id: Option<i64>,
    name: String,
    script: String,
    avatar_label: Option<String>,
    ports: Vec<u16>,
    section: String,
    order_index: i32,
    runtime_mode: String,
    run_in_external_terminal: bool,
}

#[derive(Debug, Clone, Serialize)]
struct CommandImportDiff {
    index: usize,
    status: ImportDiffStatus,
    overwrite_fields: Vec<String>,
    matched_command_id: Option<i64>,
    existing: Option<CommandPreview>,
    incoming: CommandPreview,
    default_selected: bool,
}

#[derive(Debug, Clone, Serialize)]
struct NoteImportDiff {
    index: usize,
    status: ImportDiffStatus,
    overwrite_fields: Vec<String>,
    matched_note_id: Option<String>,
    existing: Option<ProjectNoteItem>,
    incoming: ProjectNoteItem,
    default_selected: bool,
}

#[derive(Debug, Clone, Serialize)]
struct PrdImportAnalysis {
    analysis_signature: String,
    file_path: String,
    format: String,
    exported_at: String,
    project_name: String,
    project_path: String,
    description: Option<String>,
    sections: Vec<String>,
    existing_project: Option<ExistingProjectSummary>,
    project_field_changes: Vec<ProjectFieldChange>,
    command_diffs: Vec<CommandImportDiff>,
    note_diffs: Vec<NoteImportDiff>,
}

#[derive(Debug, Deserialize)]
struct ApplyPrdImportRequest {
    file_path: String,
    analysis_signature: String,
    target_project_id: Option<i64>,
    selected_project_fields: Vec<String>,
    selected_command_indexes: Vec<usize>,
    selected_note_indexes: Vec<usize>,
    overwrite_confirmed: bool,
}

#[derive(Debug, Serialize, Clone)]
struct PrdOpenRequestPayload {
    file_path: String,
}

#[derive(Debug)]
struct ExistingCommandSnapshot {
    command: ProjectCommand,
    ports: Vec<u16>,
    avatar_signature: Option<String>,
    avatar_label: Option<String>,
}

#[derive(Debug)]
struct ExistingProjectSnapshot {
    project: Project,
    notes: Vec<ProjectNoteItem>,
    commands: Vec<ExistingCommandSnapshot>,
    avatar_signature: Option<String>,
    avatar_label: Option<String>,
}

#[derive(Debug, Serialize)]
struct AnalysisSignaturePayload {
    file_sha256: String,
    target_project_id: Option<i64>,
    project_updated_at: Option<String>,
    command_snapshots: Vec<CommandAnalysisSnapshot>,
}

#[derive(Debug, Serialize)]
struct CommandAnalysisSnapshot {
    id: i64,
    updated_at: String,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn db_path_string(paths: &AppPaths) -> String {
    paths.db_path.to_string_lossy().to_string()
}

fn connect(paths: &AppPaths) -> Result<SqliteConnection, String> {
    let mut conn =
        SqliteConnection::establish(&db_path_string(paths)).map_err(|error| error.to_string())?;
    conn.batch_execute("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn init_db(paths: &AppPaths) -> Result<(), String> {
    fs::create_dir_all(&paths.avatars_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&paths.scripts_dir).map_err(|error| error.to_string())?;
    let mut conn = connect(paths)?;

    conn.batch_execute(
        "CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            avatar_path TEXT,
            description TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .map_err(|error| error.to_string())?;

    conn.batch_execute(
        "CREATE TABLE IF NOT EXISTS folder_dev_project_types (
            project_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            project_type_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, relative_path, project_type_id),
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );",
    )
    .map_err(|error| error.to_string())?;

    sql_query(
        "CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            script TEXT NOT NULL,
            avatar_path TEXT,
            ports TEXT NOT NULL DEFAULT '[]',
            section TEXT NOT NULL DEFAULT 'General',
            order_index INTEGER NOT NULL DEFAULT 0,
            runtime_mode TEXT NOT NULL DEFAULT 'internal_headless',
            run_in_external_terminal INTEGER NOT NULL DEFAULT 0,
            external_terminal_kind TEXT NOT NULL DEFAULT 'default',
            interactive_terminal_kind TEXT NOT NULL DEFAULT 'powershell',
            run_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );",
    )
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(
        "CREATE TABLE IF NOT EXISTS command_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            command_id INTEGER NOT NULL,
            flow_node_id TEXT,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            exit_code INTEGER,
            FOREIGN KEY(command_id) REFERENCES commands(id) ON DELETE CASCADE
        );",
    )
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    conn.batch_execute(
        "CREATE TABLE IF NOT EXISTS command_sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT COLLATE NOCASE NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
            UNIQUE(project_id, name)
        );",
    )
    .map_err(|error| error.to_string())?;

    conn.batch_execute(
        "CREATE TABLE IF NOT EXISTS flows (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS flow_nodes (
            id TEXT PRIMARY KEY NOT NULL,
            flow_id INTEGER NOT NULL,
            command_id INTEGER NOT NULL,
            position_x INTEGER NOT NULL DEFAULT 0,
            position_y INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(flow_id) REFERENCES flows(id) ON DELETE CASCADE,
            FOREIGN KEY(command_id) REFERENCES commands(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS flow_edges (
            id TEXT PRIMARY KEY NOT NULL,
            flow_id INTEGER NOT NULL,
            source_node_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            FOREIGN KEY(flow_id) REFERENCES flows(id) ON DELETE CASCADE,
            FOREIGN KEY(source_node_id) REFERENCES flow_nodes(id) ON DELETE CASCADE,
            FOREIGN KEY(target_node_id) REFERENCES flow_nodes(id) ON DELETE CASCADE,
            UNIQUE(flow_id, source_node_id, target_node_id)
        );",
    )
    .map_err(|error| error.to_string())?;

    ensure_column(&mut conn, "projects", "notes", "TEXT")?;
    ensure_column(&mut conn, "commands", "ports", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_column(
        &mut conn,
        "commands",
        "section",
        "TEXT NOT NULL DEFAULT 'General'",
    )?;
    ensure_column(
        &mut conn,
        "commands",
        "runtime_mode",
        "TEXT NOT NULL DEFAULT 'internal_headless'",
    )?;
    ensure_column(
        &mut conn,
        "commands",
        "run_in_external_terminal",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        &mut conn,
        "commands",
        "external_terminal_kind",
        "TEXT NOT NULL DEFAULT 'default'",
    )?;
    ensure_column(
        &mut conn,
        "commands",
        "interactive_terminal_kind",
        "TEXT NOT NULL DEFAULT 'powershell'",
    )?;
    ensure_column(
        &mut conn,
        "commands",
        "run_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(&mut conn, "command_runs", "flow_node_id", "TEXT")?;
    migrate_flow_graph_schema(&mut conn)?;
    migrate_command_sections(&mut conn)?;

    sql_query(format!(
        "UPDATE commands SET runtime_mode = '{}' WHERE runtime_mode IS NULL OR TRIM(runtime_mode) = ''",
        RUNTIME_MODE_INTERNAL_HEADLESS
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(format!(
        "UPDATE commands SET runtime_mode = '{}' WHERE run_in_external_terminal = 1",
        RUNTIME_MODE_EXTERNAL_TERMINAL
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(format!(
        "UPDATE commands SET external_terminal_kind = '{}' WHERE external_terminal_kind IS NULL OR TRIM(external_terminal_kind) = ''",
        EXTERNAL_TERMINAL_KIND_DEFAULT
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(format!(
        "UPDATE commands SET interactive_terminal_kind = '{}' WHERE interactive_terminal_kind IS NULL OR TRIM(interactive_terminal_kind) = ''",
        INTERACTIVE_TERMINAL_KIND_POWERSHELL
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn migrate_command_sections(conn: &mut SqliteConnection) -> Result<(), String> {
    let timestamp = now();
    sql_query(format!(
        "INSERT OR IGNORE INTO command_sections (project_id, name, order_index, created_at, updated_at)
         SELECT project_id, TRIM(section), MIN(order_index), '{}', '{}'
         FROM commands
         WHERE TRIM(section) <> ''
         GROUP BY project_id, TRIM(section) COLLATE NOCASE",
        timestamp, timestamp
    ))
    .execute(conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!(
        "UPDATE command_sections SET name = 'General', updated_at = '{}' WHERE name = 'General' COLLATE NOCASE AND name COLLATE BINARY <> 'General'",
        timestamp
    ))
    .execute(conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!(
        "UPDATE commands SET section = 'General', updated_at = '{}' WHERE section = 'General' COLLATE NOCASE AND section <> 'General'",
        timestamp
    ))
    .execute(conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!(
        "INSERT OR IGNORE INTO command_sections (project_id, name, order_index, created_at, updated_at)
         SELECT id, 'General', -1, '{}', '{}' FROM projects",
        timestamp, timestamp
    ))
    .execute(conn)
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn migrate_flow_graph_schema(conn: &mut SqliteConnection) -> Result<(), String> {
    #[derive(QueryableByName)]
    struct TableSql {
        #[diesel(sql_type = Text)]
        sql: String,
    }

    let node_schema =
        sql_query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'flow_nodes'")
            .get_result::<TableSql>(conn)
            .optional()
            .map_err(|error| error.to_string())?;
    let edge_schema =
        sql_query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'flow_edges'")
            .get_result::<TableSql>(conn)
            .optional()
            .map_err(|error| error.to_string())?;
    let Some(node_schema) = node_schema else {
        return Ok(());
    };
    let Some(edge_schema) = edge_schema else {
        return Ok(());
    };
    let nodes_allow_duplicate_commands = !node_schema.sql.contains("UNIQUE(flow_id, command_id)");
    let edges_allow_multiple_connections =
        !edge_schema.sql.contains("UNIQUE(flow_id, source_node_id)")
            && !edge_schema.sql.contains("UNIQUE(flow_id, target_node_id)");
    if nodes_allow_duplicate_commands && edges_allow_multiple_connections {
        return Ok(());
    }

    // SQLite cannot remove a table-level unique constraint in place. Rebuild
    // both graph tables so their foreign keys continue to point at flow_nodes.
    conn.batch_execute("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|error| error.to_string())?;
    let result = conn.batch_execute(
        "CREATE TABLE flow_nodes_next (
            id TEXT PRIMARY KEY NOT NULL,
            flow_id INTEGER NOT NULL,
            command_id INTEGER NOT NULL,
            position_x INTEGER NOT NULL DEFAULT 0,
            position_y INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(flow_id) REFERENCES flows(id) ON DELETE CASCADE,
            FOREIGN KEY(command_id) REFERENCES commands(id) ON DELETE CASCADE
        );
        INSERT INTO flow_nodes_next (id, flow_id, command_id, position_x, position_y)
            SELECT id, flow_id, command_id, position_x, position_y FROM flow_nodes;
        CREATE TABLE flow_edges_next (
            id TEXT PRIMARY KEY NOT NULL,
            flow_id INTEGER NOT NULL,
            source_node_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            FOREIGN KEY(flow_id) REFERENCES flows(id) ON DELETE CASCADE,
            FOREIGN KEY(source_node_id) REFERENCES flow_nodes_next(id) ON DELETE CASCADE,
            FOREIGN KEY(target_node_id) REFERENCES flow_nodes_next(id) ON DELETE CASCADE,
            UNIQUE(flow_id, source_node_id, target_node_id)
        );
        INSERT INTO flow_edges_next (id, flow_id, source_node_id, target_node_id)
            SELECT id, flow_id, source_node_id, target_node_id FROM flow_edges;
        DROP TABLE flow_edges;
        DROP TABLE flow_nodes;
        ALTER TABLE flow_nodes_next RENAME TO flow_nodes;
        ALTER TABLE flow_edges_next RENAME TO flow_edges;",
    );
    match result {
        Ok(()) => conn
            .batch_execute("COMMIT; PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string()),
        Err(error) => {
            let _ = conn.batch_execute("ROLLBACK; PRAGMA foreign_keys = ON;");
            Err(error.to_string())
        }
    }
}

fn ensure_column(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    #[derive(QueryableByName)]
    struct TableColumn {
        #[diesel(sql_type = Text)]
        name: String,
    }

    let columns = sql_query(format!(
        "SELECT name FROM pragma_table_info('{}')",
        quote_sql(table)
    ))
    .load::<TableColumn>(conn)
    .map_err(|error| error.to_string())?;
    if columns.iter().any(|item| item.name == column) {
        return Ok(());
    }
    sql_query(format!(
        "ALTER TABLE {} ADD COLUMN {} {}",
        table, column, definition
    ))
    .execute(conn)
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn app_paths(app: &AppHandle) -> Result<AppPaths, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(AppPaths {
        db_path: data_dir.join("projects-runner.sqlite"),
        avatars_dir: data_dir.join("avatars"),
        scripts_dir: data_dir.join("scripts"),
    })
}

fn quote_sql(value: &str) -> String {
    value.replace('\'', "''")
}

fn optional_sql(value: &Option<String>) -> String {
    value
        .as_ref()
        .map(|text| format!("'{}'", quote_sql(text)))
        .unwrap_or_else(|| "NULL".to_string())
}

fn ports_to_json(ports: &[u16]) -> Result<String, String> {
    serde_json::to_string(ports).map_err(|error| error.to_string())
}

fn ports_from_json(value: &str) -> Vec<u16> {
    serde_json::from_str(value).unwrap_or_default()
}

fn clean_section(value: Option<String>) -> String {
    value
        .map(|section| section.trim().to_string())
        .filter(|section| !section.is_empty())
        .unwrap_or_else(|| "General".to_string())
}

fn normalize_runtime_mode(
    runtime_mode: Option<&str>,
    run_in_external_terminal: Option<bool>,
) -> String {
    match runtime_mode.map(str::trim) {
        Some(RUNTIME_MODE_INTERNAL_HEADLESS) => RUNTIME_MODE_INTERNAL_HEADLESS.to_string(),
        Some(RUNTIME_MODE_INTERNAL_INTERACTIVE) => RUNTIME_MODE_INTERNAL_INTERACTIVE.to_string(),
        Some(RUNTIME_MODE_EXTERNAL_TERMINAL) => RUNTIME_MODE_EXTERNAL_TERMINAL.to_string(),
        Some(_) | None => {
            if run_in_external_terminal.unwrap_or(false) {
                RUNTIME_MODE_EXTERNAL_TERMINAL.to_string()
            } else {
                RUNTIME_MODE_INTERNAL_HEADLESS.to_string()
            }
        }
    }
}

fn normalize_external_terminal_kind(external_terminal_kind: Option<&str>) -> String {
    match external_terminal_kind.map(str::trim) {
        #[cfg(target_os = "windows")]
        Some(EXTERNAL_TERMINAL_KIND_WINDOWS_TERMINAL) => {
            EXTERNAL_TERMINAL_KIND_WINDOWS_TERMINAL.to_string()
        }
        #[cfg(target_os = "windows")]
        Some(EXTERNAL_TERMINAL_KIND_POWERSHELL) => EXTERNAL_TERMINAL_KIND_POWERSHELL.to_string(),
        #[cfg(target_os = "windows")]
        Some(EXTERNAL_TERMINAL_KIND_COMMAND_PROMPT) => {
            EXTERNAL_TERMINAL_KIND_COMMAND_PROMPT.to_string()
        }
        #[cfg(target_os = "macos")]
        Some(EXTERNAL_TERMINAL_KIND_TERMINAL_APP) => {
            EXTERNAL_TERMINAL_KIND_TERMINAL_APP.to_string()
        }
        Some(EXTERNAL_TERMINAL_KIND_DEFAULT) | Some(_) | None => {
            EXTERNAL_TERMINAL_KIND_DEFAULT.to_string()
        }
    }
}

fn normalize_interactive_terminal_kind(interactive_terminal_kind: Option<&str>) -> String {
    match interactive_terminal_kind.map(str::trim) {
        Some(INTERACTIVE_TERMINAL_KIND_CMD) => INTERACTIVE_TERMINAL_KIND_CMD.to_string(),
        Some(INTERACTIVE_TERMINAL_KIND_BASH) => INTERACTIVE_TERMINAL_KIND_BASH.to_string(),
        Some(INTERACTIVE_TERMINAL_KIND_POWERSHELL) => {
            INTERACTIVE_TERMINAL_KIND_POWERSHELL.to_string()
        }
        Some(INTERACTIVE_TERMINAL_KIND_WSL2) => INTERACTIVE_TERMINAL_KIND_WSL2.to_string(),
        Some(INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE) => {
            INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE.to_string()
        }
        Some(_) | None => INTERACTIVE_TERMINAL_KIND_POWERSHELL.to_string(),
    }
}

fn runtime_mode_uses_external_terminal(runtime_mode: &str) -> bool {
    runtime_mode == RUNTIME_MODE_EXTERNAL_TERMINAL
}

fn executable_exists(program: &str) -> bool {
    which::which(program).is_ok()
}

#[cfg(target_os = "windows")]
fn windows_path_to_wsl(path: &Path) -> Result<String, String> {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut parts = raw.splitn(2, ':');
    let drive = parts
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Invalid Windows path".to_string())?;
    let remainder = parts
        .next()
        .ok_or_else(|| "Invalid Windows path".to_string())?
        .trim_start_matches('/');
    Ok(format!("/mnt/{}/{}", drive.to_ascii_lowercase(), remainder))
}

#[cfg(target_os = "windows")]
fn bash_single_quote(value: &str) -> String {
    value.replace('\'', "'\"'\"'")
}

#[cfg(target_os = "windows")]
fn write_interactive_script(
    scripts_dir: &Path,
    script: &str,
    interactive_terminal_kind: &str,
) -> Result<PathBuf, String> {
    let (extension, content) = match interactive_terminal_kind {
        INTERACTIVE_TERMINAL_KIND_CMD => (
            "cmd",
            format!("@echo off\r\nchcp 65001>nul\r\n{}\r\n", script),
        ),
        INTERACTIVE_TERMINAL_KIND_BASH | INTERACTIVE_TERMINAL_KIND_WSL2 => (
            "sh",
            format!("#!/usr/bin/env bash\nset -e\n{}\n", script),
        ),
        INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE | INTERACTIVE_TERMINAL_KIND_POWERSHELL | _ => (
            "ps1",
            format!(
                "$ErrorActionPreference = 'Stop'\r\n[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()\r\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\r\n$OutputEncoding = [System.Text.UTF8Encoding]::new()\r\n{}\r\n",
                script
            ),
        ),
    };

    let script_path = scripts_dir.join(format!("interactive-{}.{}", Uuid::new_v4(), extension));
    fs::write(&script_path, content).map_err(|error| error.to_string())?;
    Ok(script_path)
}

#[cfg(not(target_os = "windows"))]
fn write_interactive_script(
    scripts_dir: &Path,
    script: &str,
    _interactive_terminal_kind: &str,
) -> Result<PathBuf, String> {
    let script_path = scripts_dir.join(format!("interactive-{}.sh", Uuid::new_v4()));
    let content = format!("#!/usr/bin/env sh\nset -e\n{}\n", script);
    fs::write(&script_path, content).map_err(|error| error.to_string())?;
    Ok(script_path)
}

#[cfg(target_os = "windows")]
fn build_interactive_pty_command(
    script_path: &Path,
    project_path: &Path,
    interactive_terminal_kind: &str,
) -> Result<PtyCommandBuilder, String> {
    let cmd = match interactive_terminal_kind {
        INTERACTIVE_TERMINAL_KIND_CMD => {
            let mut cmd = PtyCommandBuilder::new("cmd.exe");
            cmd.arg("/Q");
            cmd.arg("/C");
            cmd.arg(script_path);
            cmd
        }
        INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE => {
            let mut cmd = PtyCommandBuilder::new("pwsh.exe");
            cmd.arg("-NoLogo");
            cmd.arg("-NoProfile");
            cmd.arg("-ExecutionPolicy");
            cmd.arg("Bypass");
            cmd.arg("-File");
            cmd.arg(script_path);
            cmd
        }
        INTERACTIVE_TERMINAL_KIND_BASH => {
            let mut cmd = PtyCommandBuilder::new("bash.exe");
            cmd.arg(script_path);
            cmd
        }
        INTERACTIVE_TERMINAL_KIND_WSL2 => {
            let project_path_wsl = windows_path_to_wsl(project_path)?;
            let script_path_wsl = windows_path_to_wsl(script_path)?;
            let mut cmd = PtyCommandBuilder::new("wsl.exe");
            cmd.arg("--cd");
            cmd.arg(project_path_wsl);
            cmd.arg("bash");
            cmd.arg("-lc");
            cmd.arg(format!("source '{}'", bash_single_quote(&script_path_wsl)));
            cmd
        }
        INTERACTIVE_TERMINAL_KIND_POWERSHELL | _ => build_pty_command(script_path),
    };

    Ok(cmd)
}

#[cfg(not(target_os = "windows"))]
fn build_interactive_pty_command(
    script_path: &Path,
    _project_path: &Path,
    _interactive_terminal_kind: &str,
) -> Result<PtyCommandBuilder, String> {
    Ok(build_pty_command(script_path))
}

#[tauri::command]
fn list_interactive_terminal_options() -> Result<Vec<InteractiveTerminalOption>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut items = Vec::new();
        for (id, label, description, available) in [
            (
                INTERACTIVE_TERMINAL_KIND_CMD,
                "cmd",
                "Classic Windows Command Prompt.",
                executable_exists("cmd.exe"),
            ),
            (
                INTERACTIVE_TERMINAL_KIND_BASH,
                "bash",
                "Bash shell detected from your Windows environment.",
                executable_exists("bash.exe"),
            ),
            (
                INTERACTIVE_TERMINAL_KIND_POWERSHELL,
                "powershell",
                "Windows PowerShell with the app's interactive terminal.",
                executable_exists("powershell.exe"),
            ),
            (
                INTERACTIVE_TERMINAL_KIND_WSL2,
                "wsl2",
                "Run the command inside the default WSL distribution.",
                executable_exists("wsl.exe"),
            ),
            (
                INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE,
                "powershellcore",
                "PowerShell Core (`pwsh`) if installed.",
                executable_exists("pwsh.exe"),
            ),
        ] {
            if available {
                items.push(InteractiveTerminalOption {
                    id: id.to_string(),
                    label: label.to_string(),
                    description: description.to_string(),
                });
            }
        }
        if items.is_empty() {
            items.push(InteractiveTerminalOption {
                id: INTERACTIVE_TERMINAL_KIND_POWERSHELL.to_string(),
                label: "powershell".to_string(),
                description: "Windows PowerShell with the app's interactive terminal.".to_string(),
            });
        }
        return Ok(items);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![InteractiveTerminalOption {
            id: INTERACTIVE_TERMINAL_KIND_BASH.to_string(),
            label: "bash".to_string(),
            description: "Default interactive shell on this system.".to_string(),
        }])
    }
}

#[cfg(not(target_os = "windows"))]
fn command_display_name(command: &Path) -> String {
    command
        .file_name()
        .unwrap_or_else(|| OsStr::new(""))
        .to_string_lossy()
        .to_string()
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn resolve_linux_terminal_program() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("TERMINAL") {
        let configured = configured.to_string_lossy().trim().to_string();
        if !configured.is_empty() {
            let direct_path = PathBuf::from(&configured);
            if direct_path.is_file() {
                return Ok(direct_path);
            }
            if let Some(executable) = configured.split_whitespace().next() {
                if let Ok(path) = which::which(executable) {
                    return Ok(path);
                }
            }
        }
    }

    for candidate in [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "kitty",
        "wezterm",
        "alacritty",
        "xterm",
    ] {
        if let Ok(path) = which::which(candidate) {
            return Ok(path);
        }
    }

    Err(
        "No supported Linux terminal executable was found. Install a desktop terminal or set TERMINAL."
            .to_string(),
    )
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn build_linux_open_terminal_command(project_path: &Path) -> Result<Command, String> {
    let program = resolve_linux_terminal_program()?;
    let program_name = command_display_name(&program);
    let mut cmd = Command::new(&program);
    match program_name.as_str() {
        "gnome-terminal" => {
            cmd.arg("--working-directory").arg(project_path);
        }
        "konsole" => {
            cmd.arg("--workdir").arg(project_path);
        }
        "xfce4-terminal" => {
            cmd.arg("--working-directory").arg(project_path);
        }
        "wezterm" => {
            cmd.arg("start").arg("--cwd").arg(project_path);
        }
        "kitty" => {
            cmd.arg("--directory").arg(project_path);
        }
        _ => {}
    }
    cmd.current_dir(project_path);
    Ok(cmd)
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn build_linux_script_terminal_command(
    script_path: &Path,
    project_path: &Path,
) -> Result<Command, String> {
    let program = resolve_linux_terminal_program()?;
    let program_name = command_display_name(&program);
    let mut cmd = Command::new(&program);
    match program_name.as_str() {
        "gnome-terminal" => {
            cmd.arg("--working-directory")
                .arg(project_path)
                .arg("--")
                .arg("sh")
                .arg(script_path);
        }
        "konsole" => {
            cmd.arg("--workdir")
                .arg(project_path)
                .arg("-e")
                .arg("sh")
                .arg(script_path);
        }
        "xfce4-terminal" => {
            cmd.arg("--working-directory")
                .arg(project_path)
                .arg("-x")
                .arg("sh")
                .arg(script_path);
        }
        "wezterm" => {
            cmd.arg("start")
                .arg("--cwd")
                .arg(project_path)
                .arg("sh")
                .arg(script_path);
        }
        "kitty" | "alacritty" | "xterm" | "x-terminal-emulator" => {
            cmd.arg("-e").arg("sh").arg(script_path);
        }
        _ => {
            cmd.arg("-e").arg("sh").arg(script_path);
        }
    }
    cmd.current_dir(project_path);
    Ok(cmd)
}

#[cfg(not(target_os = "windows"))]
fn parse_pid_lines(stdout: &[u8]) -> Vec<u32> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn kill_pid_list(pids: impl IntoIterator<Item = u32>) {
    for pid in pids {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(not(target_os = "windows"))]
fn pids_from_lsof(port: u16) -> Result<Vec<u32>, String> {
    if !executable_exists("lsof") {
        return Ok(Vec::new());
    }

    let output = Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}")])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(Vec::new());
    }

    Ok(parse_pid_lines(&output.stdout))
}

#[cfg(target_os = "linux")]
fn pids_from_ss(port: u16) -> Result<Vec<u32>, String> {
    if !executable_exists("ss") {
        return Ok(Vec::new());
    }

    let output = Command::new("ss")
        .args(["-ltnp"])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let mut pids = HashSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if !line.contains(&format!(":{port}")) {
            continue;
        }
        let mut remaining = line;
        while let Some(index) = remaining.find("pid=") {
            let pid_portion = &remaining[index + 4..];
            let digits = pid_portion
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>();
            if let Ok(pid) = digits.parse::<u32>() {
                pids.insert(pid);
            }
            remaining = &pid_portion[digits.len()..];
        }
    }

    Ok(pids.into_iter().collect())
}

#[cfg(not(target_os = "windows"))]
fn try_kill_with_fuser(port: u16) -> Result<bool, String> {
    if !executable_exists("fuser") {
        return Ok(false);
    }

    let status = Command::new("fuser")
        .args(["-k", "-n", "tcp", &port.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;

    Ok(status.success())
}

#[cfg(target_os = "linux")]
fn port_processes_from_ss(target_ports: &HashSet<u16>) -> Result<Vec<PortProcess>, String> {
    if !executable_exists("ss") {
        return Ok(Vec::new());
    }

    let output = Command::new("ss")
        .args(["-ltnp"])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let local_port = line.split_whitespace().find_map(|part| {
            part.rsplit_once(':')
                .and_then(|(_, port)| port.parse::<u16>().ok())
        });

        let Some(port) = local_port else {
            continue;
        };
        if !target_ports.contains(&port) {
            continue;
        }

        let mut remaining = line;
        while let Some(index) = remaining.find("pid=") {
            let pid_portion = &remaining[index + 4..];
            let digits = pid_portion
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>();
            if let Ok(pid) = digits.parse::<u32>() {
                if seen.insert((port, pid)) {
                    results.push(PortProcess {
                        port,
                        pid,
                        name: "Unknown".to_string(),
                    });
                }
            }
            remaining = &pid_portion[digits.len()..];
        }
    }

    Ok(results)
}

fn normalize_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_utf8_chunks(chunks: &[&[u8]]) -> String {
        let mut decoder = Utf8StreamDecoder::default();
        let mut output = String::new();
        for chunk in chunks {
            output.push_str(&decoder.push(chunk));
        }
        output.push_str(&decoder.finish());
        output
    }

    #[test]
    fn utf8_stream_decoder_preserves_vietnamese_across_chunk_boundaries() {
        let expected = "Tiếng Việt: Trường hợp gõ bằng UniKey";
        let bytes = expected.as_bytes();

        for split in 0..=bytes.len() {
            assert_eq!(
                decode_utf8_chunks(&[&bytes[..split], &bytes[split..]]),
                expected,
                "failed at byte split {split}",
            );
        }

        let byte_chunks = bytes.iter().map(std::slice::from_ref).collect::<Vec<_>>();
        assert_eq!(decode_utf8_chunks(&byte_chunks), expected);
    }

    #[test]
    fn utf8_stream_decoder_preserves_ansi_and_replaces_invalid_sequences() {
        let ansi_text = "\u{1b}[32mViệt Nam\u{1b}[0m\r\n";
        let ansi_bytes = ansi_text.as_bytes();
        assert_eq!(
            decode_utf8_chunks(&[&ansi_bytes[..8], &ansi_bytes[8..11], &ansi_bytes[11..],]),
            ansi_text,
        );

        assert_eq!(
            decode_utf8_chunks(&[&[b'a', 0xF0], &[0x28, 0x8C, 0x28, b'b']]),
            "a\u{FFFD}(\u{FFFD}(b",
        );
        assert_eq!(decode_utf8_chunks(&[&[b'a', 0xE1, 0xBB]]), "a\u{FFFD}");
    }

    fn temp_test_paths(name: &str) -> AppPaths {
        let root =
            std::env::temp_dir().join(format!("projects-runner-tests-{}-{}", name, Uuid::new_v4()));
        AppPaths {
            db_path: root.join("projects-runner.sqlite"),
            avatars_dir: root.join("avatars"),
            scripts_dir: root.join("scripts"),
        }
    }

    fn seed_test_project(paths: &AppPaths) -> SqliteConnection {
        init_db(paths).expect("initialize test database");
        let mut conn = connect(paths).expect("open test database");
        sql_query(
            "INSERT INTO projects (id, name, path, avatar_path, description, notes, created_at, updated_at)
             VALUES (1, 'Demo', '.', NULL, NULL, NULL, 'now', 'now')",
        )
        .execute(&mut conn)
        .expect("seed project");
        migrate_command_sections(&mut conn).expect("create default section");
        conn
    }

    #[test]
    fn project_file_entry_calculates_recursive_folder_metadata() {
        let root =
            std::env::temp_dir().join(format!("projects-runner-file-metadata-{}", Uuid::new_v4()));
        let selected = root.join("selected");
        fs::create_dir_all(selected.join("nested").join("empty"))
            .expect("create nested test folders");
        fs::write(selected.join("root.txt"), b"abc").expect("write root test file");
        fs::write(selected.join("nested").join("child.txt"), b"12345")
            .expect("write nested test file");

        let info = project_file_entry(&root, &selected).expect("read folder metadata");

        assert!(info.is_directory);
        assert_eq!(info.file_kind, "folder");
        assert_eq!(info.child_folder_count, 2);
        assert_eq!(info.child_file_count, 2);
        assert_eq!(info.size_bytes, 8);

        fs::remove_dir_all(&root).expect("remove test folder");
    }

    #[test]
    fn command_section_migration_discovers_existing_names_and_general() {
        let paths = temp_test_paths("command-section-migration");
        let mut conn = seed_test_project(&paths);
        sql_query(
            "INSERT INTO commands (project_id, name, script, section, order_index, created_at, updated_at)
             VALUES
             (1, 'Dev', 'echo dev', 'Development', 2, 'now', 'now'),
             (1, 'Release', 'echo release', 'release', 3, 'now', 'now'),
             (1, 'General command', 'echo general', 'general', 4, 'now', 'now')",
        )
        .execute(&mut conn)
        .expect("seed commands");
        migrate_command_sections(&mut conn).expect("migrate command sections");

        let sections = sql_query(
            "SELECT * FROM command_sections WHERE project_id = 1 ORDER BY order_index ASC, id ASC",
        )
        .load::<CommandSection>(&mut conn)
        .expect("load sections");
        let names = sections
            .into_iter()
            .map(|section| section.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["General", "Development", "release"]);
        let general_command =
            sql_query("SELECT * FROM commands WHERE project_id = 1 AND name = 'General command'")
                .get_result::<ProjectCommand>(&mut conn)
                .expect("load canonicalized command");
        assert_eq!(general_command.section, "General");
    }

    #[test]
    fn command_section_crud_is_case_insensitive_atomic_and_requires_empty_section() {
        let paths = temp_test_paths("command-section-crud");
        let mut conn = seed_test_project(&paths);
        let development =
            ensure_command_section(&mut conn, 1, "Development", None).expect("create section");
        let same =
            ensure_command_section(&mut conn, 1, "development", None).expect("reuse section");
        assert_eq!(development.id, same.id);

        sql_query(
            "INSERT INTO commands (project_id, name, script, section, order_index, created_at, updated_at)
             VALUES (1, 'Dev', 'echo dev', 'Development', 0, 'now', 'now')",
        )
        .execute(&mut conn)
        .expect("seed section command");
        let renamed = rename_command_section_in_conn(&mut conn, development.id, "Build")
            .expect("rename section");
        assert_eq!(renamed.name, "Build");
        let command = sql_query("SELECT * FROM commands WHERE project_id = 1")
            .get_result::<ProjectCommand>(&mut conn)
            .expect("load renamed command");
        assert_eq!(command.section, "Build");

        let release =
            ensure_command_section(&mut conn, 1, "Release", None).expect("create release");
        assert!(rename_command_section_in_conn(&mut conn, development.id, "release").is_err());
        let unchanged = sql_query(format!(
            "SELECT * FROM command_sections WHERE id = {}",
            development.id
        ))
        .get_result::<CommandSection>(&mut conn)
        .expect("load unchanged section");
        assert_eq!(unchanged.name, "Build");
        assert!(delete_command_section_in_conn(&mut conn, development.id).is_err());
        sql_query("DELETE FROM commands WHERE project_id = 1")
            .execute(&mut conn)
            .expect("remove command");
        delete_command_section_in_conn(&mut conn, development.id).expect("delete empty section");
        delete_command_section_in_conn(&mut conn, release.id).expect("delete second empty section");
        let general = load_command_section(&mut conn, 1, "General")
            .expect("load general")
            .expect("general exists");
        assert!(delete_command_section_in_conn(&mut conn, general.id).is_err());
    }

    #[test]
    fn prd_v2_without_sections_remains_compatible_and_derives_sections() {
        let json = r#"{
            "format":"projects-runner.prd.v2",
            "exported_at":"2026-07-25T00:00:00Z",
            "project":{"name":"Demo","path":".","avatar":null,"description":null,"notes":[]},
            "commands":[{"name":"Dev","script":"echo ok","avatar":null,"ports":[],"section":"Development","order_index":0,"runtime_mode":"internal_headless","run_in_external_terminal":false}],
            "assets":[]
        }"#;
        let normalized =
            normalize_prd_file_v2(serde_json::from_str(json).expect("parse legacy v2 file"));
        assert_eq!(
            sections_from_prd(&normalized),
            vec!["General", "Development"]
        );
    }

    #[test]
    fn prd_export_keeps_empty_sections() {
        let project = Project {
            id: 1,
            name: "Demo".to_string(),
            path: ".".to_string(),
            avatar_path: None,
            description: None,
            notes: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        };
        let sections = vec![CommandSection {
            id: 1,
            project_id: 1,
            name: "Empty".to_string(),
            order_index: 0,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }];
        let exported = build_export_prd(&project, &[], &sections).expect("build export");
        assert_eq!(exported.sections, vec!["Empty"]);
    }

    #[test]
    fn flow_graph_allows_branches_but_rejects_duplicate_pairs_and_cycles() {
        let nodes = vec![
            FlowNodeInput {
                id: "a".to_string(),
                command_id: 1,
                position_x: 0,
                position_y: 0,
            },
            FlowNodeInput {
                id: "b".to_string(),
                command_id: 2,
                position_x: 0,
                position_y: 100,
            },
            FlowNodeInput {
                id: "c".to_string(),
                command_id: 3,
                position_x: 0,
                position_y: 200,
            },
        ];
        let edges = vec![
            FlowEdgeInput {
                id: "ab".to_string(),
                source_node_id: "a".to_string(),
                target_node_id: "b".to_string(),
            },
            FlowEdgeInput {
                id: "ac".to_string(),
                source_node_id: "a".to_string(),
                target_node_id: "c".to_string(),
            },
        ];
        assert!(validate_flow_graph(&nodes, &edges).is_ok());
        let duplicate_pair = vec![
            FlowEdgeInput {
                id: "ab".to_string(),
                source_node_id: "a".to_string(),
                target_node_id: "b".to_string(),
            },
            FlowEdgeInput {
                id: "ba".to_string(),
                source_node_id: "b".to_string(),
                target_node_id: "a".to_string(),
            },
        ];
        assert!(validate_flow_graph(&nodes[..2], &duplicate_pair).is_err());
        let cyclic = vec![
            FlowEdgeInput {
                id: "ab".to_string(),
                source_node_id: "a".to_string(),
                target_node_id: "b".to_string(),
            },
            FlowEdgeInput {
                id: "ba".to_string(),
                source_node_id: "b".to_string(),
                target_node_id: "a".to_string(),
            },
        ];
        assert!(validate_flow_graph(&nodes[..2], &cyclic).is_err());
    }

    #[test]
    fn flow_graph_allows_reusing_a_command_for_distinct_nodes() {
        let nodes = vec![
            FlowNodeInput {
                id: "first".to_string(),
                command_id: 7,
                position_x: 0,
                position_y: 0,
            },
            FlowNodeInput {
                id: "second".to_string(),
                command_id: 7,
                position_x: 0,
                position_y: 100,
            },
        ];
        let edges = vec![FlowEdgeInput {
            id: "first-second".to_string(),
            source_node_id: "first".to_string(),
            target_node_id: "second".to_string(),
        }];
        assert!(validate_flow_graph(&nodes, &edges).is_ok());
    }

    #[test]
    fn init_db_migrates_flow_graph_constraints() {
        let paths = temp_test_paths("flow-node-duplicates");
        fs::create_dir_all(paths.db_path.parent().expect("db parent")).expect("create temp root");
        let mut conn =
            SqliteConnection::establish(&db_path_string(&paths)).expect("create sqlite db");
        conn.batch_execute(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, avatar_path TEXT, description TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE commands (id INTEGER PRIMARY KEY NOT NULL, project_id INTEGER NOT NULL, name TEXT NOT NULL, script TEXT NOT NULL, avatar_path TEXT, ports TEXT NOT NULL DEFAULT '[]', section TEXT NOT NULL DEFAULT 'General', order_index INTEGER NOT NULL DEFAULT 0, runtime_mode TEXT NOT NULL DEFAULT 'internal_headless', run_in_external_terminal INTEGER NOT NULL DEFAULT 0, external_terminal_kind TEXT NOT NULL DEFAULT 'default', interactive_terminal_kind TEXT NOT NULL DEFAULT 'powershell', run_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE flows (id INTEGER PRIMARY KEY NOT NULL, project_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE flow_nodes (id TEXT PRIMARY KEY NOT NULL, flow_id INTEGER NOT NULL, command_id INTEGER NOT NULL, position_x INTEGER NOT NULL DEFAULT 0, position_y INTEGER NOT NULL DEFAULT 0, UNIQUE(flow_id, command_id));
             CREATE TABLE flow_edges (id TEXT PRIMARY KEY NOT NULL, flow_id INTEGER NOT NULL, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL, UNIQUE(flow_id, source_node_id), UNIQUE(flow_id, target_node_id));
             INSERT INTO projects VALUES (1, 'Project', '.', NULL, NULL, NULL, 'now', 'now');
             INSERT INTO commands VALUES (1, 1, 'Command', 'echo ok', NULL, '[]', 'General', 0, 'internal_headless', 0, 'default', 'powershell', 0, 'now', 'now');
             INSERT INTO flows VALUES (1, 1, 'Flow', 'now', 'now');
             INSERT INTO flow_nodes VALUES ('first', 1, 1, 0, 0);",
        ).expect("create legacy flow schema");

        init_db(&paths).expect("migrate flow nodes");
        let mut verify = connect(&paths).expect("reopen database");
        sql_query("INSERT INTO flow_nodes (id, flow_id, command_id, position_x, position_y) VALUES ('second', 1, 1, 0, 100)")
            .execute(&mut verify)
            .expect("allow a repeated command in a flow");
        sql_query("INSERT INTO flow_nodes (id, flow_id, command_id, position_x, position_y) VALUES ('third', 1, 1, 0, 200)")
            .execute(&mut verify)
            .expect("create a third graph node");
        sql_query("INSERT INTO flow_edges (id, flow_id, source_node_id, target_node_id) VALUES ('first-second', 1, 'first', 'second')")
            .execute(&mut verify)
            .expect("create the first branch");
        sql_query("INSERT INTO flow_edges (id, flow_id, source_node_id, target_node_id) VALUES ('first-third', 1, 'first', 'third')")
            .execute(&mut verify)
            .expect("allow multiple connections from one node");
    }

    #[test]
    fn init_db_migrates_runtime_mode_for_legacy_commands_table() {
        let paths = temp_test_paths("runtime-mode-migration");
        fs::create_dir_all(paths.db_path.parent().expect("db parent")).expect("create temp root");
        let mut conn =
            SqliteConnection::establish(&db_path_string(&paths)).expect("create sqlite db");
        conn.batch_execute(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                avatar_path TEXT,
                description TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                script TEXT NOT NULL,
                avatar_path TEXT,
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                ports TEXT NOT NULL DEFAULT '[]',
                section TEXT NOT NULL DEFAULT 'General',
                run_in_external_terminal INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            INSERT INTO projects (id, name, path, created_at, updated_at)
            VALUES (1, 'Demo', 'E:/demo', '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z');
            INSERT INTO commands (id, project_id, name, script, avatar_path, order_index, created_at, updated_at, ports, section, run_in_external_terminal)
            VALUES
                (1, 1, 'Headless', 'echo ok', NULL, 0, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z', '[]', 'General', 0),
                (2, 1, 'External', 'echo ext', NULL, 1, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z', '[]', 'General', 1);",
        )
        .expect("seed legacy schema");
        drop(conn);

        init_db(&paths).expect("migrate legacy schema");

        let mut verify =
            SqliteConnection::establish(&db_path_string(&paths)).expect("open migrated db");
        #[derive(QueryableByName)]
        struct CommandRuntimeRow {
            #[diesel(sql_type = Text)]
            runtime_mode: String,
        }

        let runtime_modes = sql_query("SELECT runtime_mode FROM commands ORDER BY id ASC")
            .load::<CommandRuntimeRow>(&mut verify)
            .expect("read runtime modes")
            .into_iter()
            .map(|row| row.runtime_mode)
            .collect::<Vec<_>>();
        assert_eq!(
            runtime_modes,
            vec![
                RUNTIME_MODE_INTERNAL_HEADLESS.to_string(),
                RUNTIME_MODE_EXTERNAL_TERMINAL.to_string(),
            ]
        );

        #[derive(QueryableByName)]
        struct TableColumn {
            #[diesel(sql_type = Text)]
            name: String,
        }

        let columns = sql_query("SELECT name FROM pragma_table_info('commands')")
            .load::<TableColumn>(&mut verify)
            .expect("read command columns")
            .into_iter()
            .map(|row| row.name)
            .collect::<Vec<_>>();
        assert!(columns.iter().any(|name| name == "runtime_mode"));

        #[derive(QueryableByName)]
        struct TableName {
            #[diesel(sql_type = Text)]
            name: String,
        }
        let flow_tables = sql_query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('flows', 'flow_nodes', 'flow_edges') ORDER BY name")
            .load::<TableName>(&mut verify)
            .expect("read flow tables")
            .into_iter()
            .map(|row| row.name)
            .collect::<Vec<_>>();
        assert_eq!(flow_tables, vec!["flow_edges", "flow_nodes", "flows"]);

        drop(verify);
        fs::remove_dir_all(paths.db_path.parent().expect("db parent")).expect("cleanup temp root");
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(sha256_hex(&bytes))
}

fn display_file_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| value.to_string())
}

fn lucide_icon_id(value: &str) -> Option<&str> {
    value.strip_prefix(LUCIDE_ICON_PREFIX)
}

fn avatar_label_from_existing_path(path: Option<&str>) -> Option<String> {
    let value = path?;
    if let Some(icon_id) = lucide_icon_id(value) {
        return Some(format!("Icon: {}", icon_id));
    }
    Some(format!("Image: {}", display_file_name(value)))
}

fn avatar_label_from_prd_ref(
    avatar: Option<&PrdAvatarRef>,
    assets: &HashMap<String, PrdAsset>,
) -> Option<String> {
    match avatar {
        Some(PrdAvatarRef::Icon { value }) => {
            Some(format!("Icon: {}", lucide_icon_id(value).unwrap_or(value)))
        }
        Some(PrdAvatarRef::Asset { asset_id }) => assets
            .get(asset_id)
            .map(|asset| format!("Embedded image: {}", asset.file_name))
            .or_else(|| Some("Embedded image".to_string())),
        Some(PrdAvatarRef::Path { value }) => {
            Some(format!("Image path: {}", display_file_name(value)))
        }
        None => None,
    }
}

fn avatar_signature_from_existing_path(path: Option<&str>) -> Option<String> {
    let value = path?;
    if lucide_icon_id(value).is_some() {
        return Some(format!("icon:{}", value));
    }
    let path_buf = PathBuf::from(value);
    if let Ok(bytes) = fs::read(&path_buf) {
        return Some(format!("sha256:{}", sha256_hex(&bytes)));
    }
    Some(format!("path:{}", value))
}

fn avatar_signature_from_prd(
    avatar: Option<&PrdAvatarRef>,
    assets: &HashMap<String, PrdAsset>,
) -> Option<String> {
    match avatar {
        Some(PrdAvatarRef::Icon { value }) => Some(format!("icon:{}", value)),
        Some(PrdAvatarRef::Asset { asset_id }) => assets
            .get(asset_id)
            .map(|asset| format!("sha256:{}", asset.sha256)),
        Some(PrdAvatarRef::Path { value }) => {
            let path = PathBuf::from(value);
            if let Ok(bytes) = fs::read(path) {
                Some(format!("sha256:{}", sha256_hex(&bytes)))
            } else {
                Some(format!("path:{}", value))
            }
        }
        None => None,
    }
}

fn avatar_ref_from_path(path: Option<String>) -> Option<PrdAvatarRef> {
    match path {
        Some(value) if lucide_icon_id(&value).is_some() => Some(PrdAvatarRef::Icon { value }),
        Some(value) => Some(PrdAvatarRef::Path { value }),
        None => None,
    }
}

fn parse_project_notes(value: Option<&str>) -> Vec<ProjectNoteItem> {
    let Some(raw) = value.map(str::trim).filter(|text| !text.is_empty()) else {
        return Vec::new();
    };

    let parsed = serde_json::from_str::<serde_json::Value>(raw);
    if let Ok(serde_json::Value::Array(items)) = parsed {
        let mut notes = Vec::new();
        for (index, item) in items.into_iter().enumerate() {
            let Some(object) = item.as_object() else {
                continue;
            };
            let content = object
                .get("content")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if content.is_empty() {
                continue;
            }
            let fallback_time = now();
            let id = object
                .get("id")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| format!("note-{}-{}", index, fallback_time));
            let created_at = object
                .get("createdAt")
                .or_else(|| object.get("created_at"))
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| fallback_time.clone());
            let updated_at = object
                .get("updatedAt")
                .or_else(|| object.get("updated_at"))
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| fallback_time.clone());
            let pinned = object
                .get("pinned")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            notes.push(ProjectNoteItem {
                id,
                content,
                pinned,
                created_at,
                updated_at,
            });
        }
        return notes;
    }

    let fallback_time = now();
    vec![ProjectNoteItem {
        id: format!("legacy-note-{}", fallback_time),
        content: raw.to_string(),
        pinned: false,
        created_at: fallback_time.clone(),
        updated_at: fallback_time,
    }]
}

fn serialize_project_notes(notes: &[ProjectNoteItem]) -> Result<Option<String>, String> {
    let clean_notes = notes
        .iter()
        .filter_map(|note| {
            let content = note.content.trim().to_string();
            if content.is_empty() {
                return None;
            }
            Some(ProjectNoteItem {
                id: note.id.clone(),
                content,
                pinned: note.pinned,
                created_at: note.created_at.clone(),
                updated_at: note.updated_at.clone(),
            })
        })
        .collect::<Vec<_>>();

    if clean_notes.is_empty() {
        Ok(None)
    } else {
        serde_json::to_string(&clean_notes)
            .map(Some)
            .map_err(|error| error.to_string())
    }
}

fn sections_from_prd(prd: &NormalizedPrdFile) -> Vec<String> {
    let mut sections = Vec::<String>::new();
    for name in prd
        .sections
        .iter()
        .chain(prd.commands.iter().map(|command| &command.section))
    {
        let clean_name = name.trim();
        if !clean_name.is_empty()
            && !sections
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(clean_name))
        {
            sections.push(clean_name.to_string());
        }
    }
    if !sections
        .iter()
        .any(|name| name.eq_ignore_ascii_case("General"))
    {
        sections.insert(0, "General".to_string());
    }
    sections
}

fn load_project_by_id(conn: &mut SqliteConnection, project_id: i64) -> Result<Project, String> {
    sql_query(format!("SELECT * FROM projects WHERE id = {}", project_id))
        .get_result::<Project>(conn)
        .map_err(|error| error.to_string())
}

fn load_commands_by_project_id(
    conn: &mut SqliteConnection,
    project_id: i64,
) -> Result<Vec<ProjectCommand>, String> {
    sql_query(format!(
        "SELECT * FROM commands WHERE project_id = {} ORDER BY order_index ASC, id ASC",
        project_id
    ))
    .load::<ProjectCommand>(conn)
    .map_err(|error| error.to_string())
}

fn load_existing_project_snapshot(
    paths: &AppPaths,
    project_id: i64,
) -> Result<ExistingProjectSnapshot, String> {
    let mut conn = connect(paths)?;
    let project = load_project_by_id(&mut conn, project_id)?;
    let commands = load_commands_by_project_id(&mut conn, project_id)?
        .into_iter()
        .map(|command| ExistingCommandSnapshot {
            ports: ports_from_json(&command.ports),
            avatar_signature: avatar_signature_from_existing_path(command.avatar_path.as_deref()),
            avatar_label: avatar_label_from_existing_path(command.avatar_path.as_deref()),
            command,
        })
        .collect::<Vec<_>>();
    let notes = parse_project_notes(project.notes.as_deref());
    let avatar_signature = avatar_signature_from_existing_path(project.avatar_path.as_deref());
    let avatar_label = avatar_label_from_existing_path(project.avatar_path.as_deref());
    Ok(ExistingProjectSnapshot {
        project,
        notes,
        commands,
        avatar_signature,
        avatar_label,
    })
}

fn find_existing_project_for_prd(
    paths: &AppPaths,
    prd: &NormalizedPrdFile,
) -> Result<Option<Project>, String> {
    let mut conn = connect(paths)?;
    let projects = sql_query("SELECT * FROM projects ORDER BY updated_at DESC, id DESC")
        .load::<Project>(&mut conn)
        .map_err(|error| error.to_string())?;
    let normalized_name = normalize_key(&prd.project.name);
    let normalized_path = normalize_key(&prd.project.path);

    if let Some(project) = projects.iter().find(|project| {
        normalize_key(&project.name) == normalized_name
            && normalize_key(&project.path) == normalized_path
    }) {
        return Ok(Some(project.clone()));
    }

    Ok(projects
        .into_iter()
        .find(|project| normalize_key(&project.name) == normalized_name))
}

fn build_project_field_changes(
    existing: &ExistingProjectSnapshot,
    prd: &NormalizedPrdFile,
) -> Vec<ProjectFieldChange> {
    let mut changes = Vec::new();

    let existing_path = normalize_optional_text(Some(&existing.project.path));
    let incoming_path = normalize_optional_text(Some(&prd.project.path));
    if existing_path != incoming_path {
        changes.push(ProjectFieldChange {
            field: "path".to_string(),
            label: "Project folder".to_string(),
            status: ProjectFieldStatus::Overwrite,
            existing_value: existing_path,
            incoming_value: incoming_path,
        });
    }

    let existing_description = normalize_optional_text(existing.project.description.as_deref());
    let incoming_description = normalize_optional_text(prd.project.description.as_deref());
    if existing_description != incoming_description {
        changes.push(ProjectFieldChange {
            field: "description".to_string(),
            label: "Description".to_string(),
            status: if existing_description.is_none() {
                ProjectFieldStatus::New
            } else {
                ProjectFieldStatus::Overwrite
            },
            existing_value: existing_description,
            incoming_value: incoming_description,
        });
    }

    let incoming_avatar_label = avatar_label_from_prd_ref(prd.project.avatar.as_ref(), &prd.assets);
    let incoming_avatar_signature =
        avatar_signature_from_prd(prd.project.avatar.as_ref(), &prd.assets);
    if existing.avatar_signature != incoming_avatar_signature {
        changes.push(ProjectFieldChange {
            field: "avatar".to_string(),
            label: "Avatar".to_string(),
            status: if existing.avatar_signature.is_none() {
                ProjectFieldStatus::New
            } else {
                ProjectFieldStatus::Overwrite
            },
            existing_value: existing.avatar_label.clone(),
            incoming_value: incoming_avatar_label,
        });
    }

    changes
}

fn build_command_preview_from_existing(snapshot: &ExistingCommandSnapshot) -> CommandPreview {
    CommandPreview {
        id: Some(snapshot.command.id),
        name: snapshot.command.name.clone(),
        script: snapshot.command.script.clone(),
        avatar_label: snapshot.avatar_label.clone(),
        ports: snapshot.ports.clone(),
        section: snapshot.command.section.clone(),
        order_index: snapshot.command.order_index,
        runtime_mode: snapshot.command.runtime_mode.clone(),
        run_in_external_terminal: snapshot.command.run_in_external_terminal != 0,
    }
}

fn build_command_preview_from_prd(
    command: &NormalizedPrdCommand,
    assets: &HashMap<String, PrdAsset>,
) -> CommandPreview {
    CommandPreview {
        id: None,
        name: command.name.clone(),
        script: command.script.clone(),
        avatar_label: avatar_label_from_prd_ref(command.avatar.as_ref(), assets),
        ports: command.ports.clone(),
        section: command.section.clone(),
        order_index: command.order_index,
        runtime_mode: command.runtime_mode.clone(),
        run_in_external_terminal: command.run_in_external_terminal,
    }
}

fn build_command_diffs(
    existing: Option<&ExistingProjectSnapshot>,
    prd: &NormalizedPrdFile,
) -> Vec<CommandImportDiff> {
    let mut matched_ids = HashSet::new();
    let existing_commands = existing
        .map(|snapshot| snapshot.commands.iter().collect::<Vec<_>>())
        .unwrap_or_default();

    prd.commands
        .iter()
        .enumerate()
        .map(|(index, command)| {
            let incoming_key = format!(
                "{}::{}",
                normalize_key(&command.section),
                normalize_key(&command.name)
            );
            let matched = existing_commands.iter().find(|candidate| {
                if matched_ids.contains(&candidate.command.id) {
                    return false;
                }
                let candidate_key = format!(
                    "{}::{}",
                    normalize_key(&candidate.command.section),
                    normalize_key(&candidate.command.name)
                );
                candidate_key == incoming_key
            });

            let incoming_avatar_signature =
                avatar_signature_from_prd(command.avatar.as_ref(), &prd.assets);
            let incoming_preview = build_command_preview_from_prd(command, &prd.assets);

            if let Some(existing_command) = matched {
                matched_ids.insert(existing_command.command.id);
                let mut overwrite_fields = Vec::new();
                if existing_command.command.script != command.script {
                    overwrite_fields.push("script".to_string());
                }
                if existing_command.ports != command.ports {
                    overwrite_fields.push("ports".to_string());
                }
                if existing_command.command.order_index != command.order_index {
                    overwrite_fields.push("order_index".to_string());
                }
                if existing_command.command.runtime_mode != command.runtime_mode {
                    overwrite_fields.push("runtime_mode".to_string());
                }
                if (existing_command.command.run_in_external_terminal != 0)
                    != command.run_in_external_terminal
                {
                    overwrite_fields.push("run_in_external_terminal".to_string());
                }
                if existing_command.avatar_signature != incoming_avatar_signature {
                    overwrite_fields.push("avatar".to_string());
                }

                let status = if overwrite_fields.is_empty() {
                    ImportDiffStatus::Identical
                } else {
                    ImportDiffStatus::Overwrite
                };

                CommandImportDiff {
                    index,
                    status: status.clone(),
                    overwrite_fields,
                    matched_command_id: Some(existing_command.command.id),
                    existing: Some(build_command_preview_from_existing(existing_command)),
                    incoming: incoming_preview,
                    default_selected: !matches!(status, ImportDiffStatus::Identical),
                }
            } else {
                CommandImportDiff {
                    index,
                    status: ImportDiffStatus::New,
                    overwrite_fields: Vec::new(),
                    matched_command_id: None,
                    existing: None,
                    incoming: incoming_preview,
                    default_selected: true,
                }
            }
        })
        .collect()
}

fn build_note_diffs(
    existing: Option<&ExistingProjectSnapshot>,
    prd: &NormalizedPrdFile,
) -> Vec<NoteImportDiff> {
    let mut used_note_ids = HashSet::new();
    let existing_notes = existing
        .map(|snapshot| snapshot.notes.iter().collect::<Vec<_>>())
        .unwrap_or_default();

    prd.project
        .notes
        .iter()
        .enumerate()
        .map(|(index, note)| {
            let matched = existing_notes.iter().find(|candidate| {
                if used_note_ids.contains(&candidate.id) {
                    return false;
                }
                if !note.id.trim().is_empty() && candidate.id == note.id {
                    return true;
                }
                normalize_key(&candidate.content) == normalize_key(&note.content)
            });

            if let Some(existing_note) = matched {
                used_note_ids.insert(existing_note.id.clone());
                let mut overwrite_fields = Vec::new();
                if existing_note.content != note.content {
                    overwrite_fields.push("content".to_string());
                }
                if existing_note.pinned != note.pinned {
                    overwrite_fields.push("pinned".to_string());
                }
                if existing_note.created_at != note.created_at {
                    overwrite_fields.push("created_at".to_string());
                }
                if existing_note.updated_at != note.updated_at {
                    overwrite_fields.push("updated_at".to_string());
                }

                let status = if overwrite_fields.is_empty() {
                    ImportDiffStatus::Identical
                } else {
                    ImportDiffStatus::Overwrite
                };

                NoteImportDiff {
                    index,
                    status: status.clone(),
                    overwrite_fields,
                    matched_note_id: Some(existing_note.id.clone()),
                    existing: Some((*existing_note).clone()),
                    incoming: note.clone(),
                    default_selected: !matches!(status, ImportDiffStatus::Identical),
                }
            } else {
                NoteImportDiff {
                    index,
                    status: ImportDiffStatus::New,
                    overwrite_fields: Vec::new(),
                    matched_note_id: None,
                    existing: None,
                    incoming: note.clone(),
                    default_selected: true,
                }
            }
        })
        .collect()
}

fn build_analysis_signature(
    file_path: &Path,
    existing_project: Option<&ExistingProjectSnapshot>,
) -> Result<String, String> {
    let payload = AnalysisSignaturePayload {
        file_sha256: file_sha256(file_path)?,
        target_project_id: existing_project.map(|snapshot| snapshot.project.id),
        project_updated_at: existing_project.map(|snapshot| snapshot.project.updated_at.clone()),
        command_snapshots: existing_project
            .map(|snapshot| {
                snapshot
                    .commands
                    .iter()
                    .map(|command| CommandAnalysisSnapshot {
                        id: command.command.id,
                        updated_at: command.command.updated_at.clone(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    };
    let content = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    Ok(sha256_hex(&content))
}

fn analyze_prd_path(file_path: &Path, paths: &AppPaths) -> Result<PrdImportAnalysis, String> {
    let prd = read_prd_file(file_path)?;
    let existing_project = find_existing_project_for_prd(paths, &prd)?
        .map(|project| load_existing_project_snapshot(paths, project.id))
        .transpose()?;
    let sections = sections_from_prd(&prd);
    let project_field_changes = existing_project
        .as_ref()
        .map(|snapshot| build_project_field_changes(snapshot, &prd))
        .unwrap_or_default();
    let command_diffs = build_command_diffs(existing_project.as_ref(), &prd);
    let note_diffs = build_note_diffs(existing_project.as_ref(), &prd);
    let analysis_signature = build_analysis_signature(file_path, existing_project.as_ref())?;

    Ok(PrdImportAnalysis {
        analysis_signature,
        file_path: file_path.to_string_lossy().to_string(),
        format: prd.format.clone(),
        exported_at: prd.exported_at.clone(),
        project_name: prd.project.name.clone(),
        project_path: prd.project.path.clone(),
        description: prd.project.description.clone(),
        sections,
        existing_project: existing_project
            .as_ref()
            .map(|snapshot| ExistingProjectSummary {
                id: snapshot.project.id,
                name: snapshot.project.name.clone(),
                path: snapshot.project.path.clone(),
                description: snapshot.project.description.clone(),
                avatar_label: snapshot.avatar_label.clone(),
                command_count: snapshot.commands.len(),
                note_count: snapshot.notes.len(),
            }),
        project_field_changes,
        command_diffs,
        note_diffs,
    })
}

fn extension_from_asset(asset: &PrdAsset) -> String {
    Path::new(&asset.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            mime_guess::get_mime_extensions_str(&asset.mime_type)
                .and_then(|items| items.first().copied())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "png".to_string())
}

fn restore_imported_avatar(
    avatar: Option<&PrdAvatarRef>,
    assets: &HashMap<String, PrdAsset>,
    paths: &AppPaths,
    kind: &str,
    owner_hint: &str,
) -> Result<Option<String>, String> {
    match avatar {
        None => Ok(None),
        Some(PrdAvatarRef::Icon { value }) => Ok(Some(value.clone())),
        Some(PrdAvatarRef::Path { value }) => {
            if Path::new(value).exists() {
                Ok(Some(value.clone()))
            } else {
                Ok(None)
            }
        }
        Some(PrdAvatarRef::Asset { asset_id }) => {
            let asset = assets
                .get(asset_id)
                .ok_or_else(|| format!("Missing embedded asset: {}", asset_id))?;
            let bytes = BASE64_STANDARD
                .decode(&asset.data_base64)
                .map_err(|error| error.to_string())?;
            let actual_sha = sha256_hex(&bytes);
            if actual_sha != asset.sha256 {
                return Err(format!(
                    "Embedded asset checksum mismatch for {}",
                    asset.file_name
                ));
            }
            fs::create_dir_all(&paths.avatars_dir).map_err(|error| error.to_string())?;
            let extension = extension_from_asset(asset);
            let file_name = format!("{}-{}-{}.{}", kind, owner_hint, Uuid::new_v4(), extension);
            let target = paths.avatars_dir.join(file_name);
            fs::write(&target, bytes).map_err(|error| error.to_string())?;
            Ok(Some(target.to_string_lossy().to_string()))
        }
    }
}

struct ExportAssetRegistry {
    by_sha: HashMap<String, String>,
    assets: Vec<PrdAsset>,
}

impl ExportAssetRegistry {
    fn new() -> Self {
        Self {
            by_sha: HashMap::new(),
            assets: Vec::new(),
        }
    }

    fn capture_avatar(
        &mut self,
        avatar_path: Option<&str>,
    ) -> Result<Option<PrdAvatarRef>, String> {
        let Some(value) = avatar_path else {
            return Ok(None);
        };

        if lucide_icon_id(value).is_some() {
            return Ok(Some(PrdAvatarRef::Icon {
                value: value.to_string(),
            }));
        }

        let source = PathBuf::from(value);
        if !source.exists() {
            return Ok(Some(PrdAvatarRef::Path {
                value: value.to_string(),
            }));
        }

        let bytes = fs::read(&source).map_err(|error| error.to_string())?;
        let sha256 = sha256_hex(&bytes);
        if let Some(existing_id) = self.by_sha.get(&sha256) {
            return Ok(Some(PrdAvatarRef::Asset {
                asset_id: existing_id.clone(),
            }));
        }

        let asset_id = format!("asset-{}", &sha256[..12]);
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| format!("{}.png", asset_id));
        let mime_type = MimeGuess::from_path(&source)
            .first_or_octet_stream()
            .essence_str()
            .to_string();

        self.assets.push(PrdAsset {
            id: asset_id.clone(),
            file_name,
            mime_type,
            sha256: sha256.clone(),
            data_base64: BASE64_STANDARD.encode(&bytes),
        });
        self.by_sha.insert(sha256, asset_id.clone());

        Ok(Some(PrdAvatarRef::Asset { asset_id }))
    }
}

fn build_export_prd(
    project: &Project,
    commands: &[ProjectCommand],
    sections: &[CommandSection],
) -> Result<PrdFileV2, String> {
    let mut assets = ExportAssetRegistry::new();
    Ok(PrdFileV2 {
        format: PRD_V2_FORMAT.to_string(),
        exported_at: now(),
        project: PrdProjectV2 {
            name: project.name.clone(),
            path: project.path.clone(),
            avatar: assets.capture_avatar(project.avatar_path.as_deref())?,
            description: project.description.clone(),
            notes: parse_project_notes(project.notes.as_deref()),
        },
        commands: commands
            .iter()
            .map(|command| {
                Ok(PrdCommandV2 {
                    name: command.name.clone(),
                    script: command.script.clone(),
                    avatar: assets.capture_avatar(command.avatar_path.as_deref())?,
                    ports: ports_from_json(&command.ports),
                    section: command.section.clone(),
                    order_index: command.order_index,
                    runtime_mode: command.runtime_mode.clone(),
                    run_in_external_terminal: command.run_in_external_terminal != 0,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        sections: sections
            .iter()
            .map(|section| section.name.clone())
            .collect(),
        assets: assets.assets,
    })
}

fn import_prd_as_new_project(
    prd: &NormalizedPrdFile,
    state: State<AppState>,
) -> Result<Project, String> {
    let notes = serialize_project_notes(&prd.project.notes)?;
    let project = create_project(
        ProjectInput {
            name: prd.project.name.clone(),
            path: prd.project.path.clone(),
            avatar_path: None,
            description: prd.project.description.clone(),
            notes,
        },
        state.clone(),
    )?;

    let restored_project_avatar = restore_imported_avatar(
        prd.project.avatar.as_ref(),
        &prd.assets,
        &state.paths,
        "project",
        &project.id.to_string(),
    )?;
    let project = update_project(
        project.id,
        ProjectInput {
            name: project.name.clone(),
            path: project.path.clone(),
            avatar_path: restored_project_avatar,
            description: project.description.clone(),
            notes: project.notes.clone(),
        },
        state.clone(),
    )?;

    {
        let mut conn = connect(&state.paths)?;
        for (index, section) in sections_from_prd(prd).iter().enumerate() {
            ensure_command_section(&mut conn, project.id, section, Some(index as i32))?;
        }
    }

    for (index, command) in prd.commands.iter().enumerate() {
        let avatar_path = restore_imported_avatar(
            command.avatar.as_ref(),
            &prd.assets,
            &state.paths,
            "command",
            &format!("{}-{}", project.id, index),
        )?;
        let _ = create_command(
            CommandInput {
                project_id: project.id,
                name: command.name.clone(),
                script: command.script.clone(),
                avatar_path,
                ports: Some(command.ports.clone()),
                section: Some(command.section.clone()),
                order_index: Some(command.order_index),
                runtime_mode: Some(command.runtime_mode.clone()),
                run_in_external_terminal: Some(command.run_in_external_terminal),
                external_terminal_kind: Some(EXTERNAL_TERMINAL_KIND_DEFAULT.to_string()),
                interactive_terminal_kind: None,
            },
            state.clone(),
        )?;
    }

    let mut conn = connect(&state.paths)?;
    load_project_by_id(&mut conn, project.id)
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Projects Runner".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn export_project(project_id: i64, state: State<AppState>) -> Result<Option<String>, String> {
    let mut conn = connect(&state.paths)?;
    let project = load_project_by_id(&mut conn, project_id)?;
    let commands = load_commands_by_project_id(&mut conn, project_id)?;
    let sections = sql_query(format!(
        "SELECT * FROM command_sections WHERE project_id = {} ORDER BY order_index ASC, id ASC",
        project_id
    ))
    .load::<CommandSection>(&mut conn)
    .map_err(|error| error.to_string())?;
    let default_name = format!("{}.prd", sanitize_file_name(&project.name));
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Project Runner Data", &["prd"])
        .set_file_name(&default_name)
        .save_file()
    else {
        return Ok(None);
    };

    let prd = build_export_prd(&project, &commands, &sections)?;
    let content = serde_json::to_string_pretty(&prd).map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_prd_file() -> Result<Option<ImportPreview>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Project Runner Data", &["prd"])
        .pick_file()
    else {
        return Ok(None);
    };
    let prd = read_prd_file(&path)?;
    let sections = sections_from_prd(&prd);
    Ok(Some(ImportPreview {
        file_path: path.to_string_lossy().to_string(),
        project_name: prd.project.name.clone(),
        project_path: prd.project.path.clone(),
        description: prd.project.description.clone(),
        command_count: prd.commands.len(),
        sections,
    }))
}

#[tauri::command]
fn analyze_prd_file(
    file_path: String,
    state: State<AppState>,
) -> Result<PrdImportAnalysis, String> {
    analyze_prd_path(&PathBuf::from(file_path), &state.paths)
}

#[tauri::command]
fn import_prd_file(file_path: String, state: State<AppState>) -> Result<Project, String> {
    let path = PathBuf::from(file_path);
    let prd = read_prd_file(&path)?;
    if find_existing_project_for_prd(&state.paths, &prd)?.is_some() {
        return Err(
            "A project with the same name already exists. Review the import preview instead."
                .to_string(),
        );
    }
    import_prd_as_new_project(&prd, state)
}

#[tauri::command]
fn apply_prd_import(
    request: ApplyPrdImportRequest,
    state: State<AppState>,
) -> Result<Project, String> {
    let file_path = PathBuf::from(&request.file_path);
    let analysis = analyze_prd_path(&file_path, &state.paths)?;
    if analysis.analysis_signature != request.analysis_signature {
        return Err(
            "Import preview is out of date. Please reopen the .prd file and review it again."
                .to_string(),
        );
    }

    let prd = read_prd_file(&file_path)?;
    let current_existing = find_existing_project_for_prd(&state.paths, &prd)?;

    match (request.target_project_id, current_existing) {
        (None, None) => import_prd_as_new_project(&prd, state),
        (None, Some(_)) => Err(
            "A matching project now exists. Please reopen the .prd file and review the import wizard."
                .to_string(),
        ),
        (Some(target_project_id), Some(project)) if project.id == target_project_id => {
            let selected_project_fields = request
                .selected_project_fields
                .iter()
                .cloned()
                .collect::<HashSet<_>>();
            let selected_command_indexes = request
                .selected_command_indexes
                .iter()
                .copied()
                .collect::<HashSet<_>>();
            let selected_note_indexes = request
                .selected_note_indexes
                .iter()
                .copied()
                .collect::<HashSet<_>>();

            let has_overwrites = analysis.project_field_changes.iter().any(|change| {
                selected_project_fields.contains(&change.field)
                    && matches!(change.status, ProjectFieldStatus::Overwrite)
            }) || analysis.command_diffs.iter().any(|diff| {
                selected_command_indexes.contains(&diff.index)
                    && matches!(diff.status, ImportDiffStatus::Overwrite)
            }) || analysis.note_diffs.iter().any(|diff| {
                selected_note_indexes.contains(&diff.index)
                    && matches!(diff.status, ImportDiffStatus::Overwrite)
            });

            if has_overwrites && !request.overwrite_confirmed {
                return Err("This import would overwrite existing items. Please confirm the overwrite preview before importing.".to_string());
            }

            let snapshot = load_existing_project_snapshot(&state.paths, target_project_id)?;
            let mut next_notes = snapshot.notes.clone();
            for diff in &analysis.note_diffs {
                if !selected_note_indexes.contains(&diff.index) {
                    continue;
                }
                match diff.status {
                    ImportDiffStatus::Identical => {}
                    ImportDiffStatus::New => next_notes.push(diff.incoming.clone()),
                    ImportDiffStatus::Overwrite => {
                        if let Some(matched_note_id) = &diff.matched_note_id {
                            if let Some(existing_note) =
                                next_notes.iter_mut().find(|note| note.id == *matched_note_id)
                            {
                                *existing_note = diff.incoming.clone();
                            }
                        }
                    }
                }
            }

            let mut avatar_path = snapshot.project.avatar_path.clone();
            let mut project_path = snapshot.project.path.clone();
            let mut project_description = snapshot.project.description.clone();

            if selected_project_fields.contains("path") {
                project_path = prd.project.path.clone();
            }
            if selected_project_fields.contains("description") {
                project_description = prd.project.description.clone();
            }
            if selected_project_fields.contains("avatar") {
                avatar_path = restore_imported_avatar(
                    prd.project.avatar.as_ref(),
                    &prd.assets,
                    &state.paths,
                    "project",
                    &target_project_id.to_string(),
                )?;
            }

            let should_update_project = selected_project_fields.contains("path")
                || selected_project_fields.contains("description")
                || selected_project_fields.contains("avatar")
                || selected_note_indexes
                    .iter()
                    .any(|index| analysis.note_diffs.iter().any(|diff| diff.index == *index));

            let project = if should_update_project {
                update_project(
                    target_project_id,
                    ProjectInput {
                        name: snapshot.project.name.clone(),
                        path: project_path,
                        avatar_path,
                        description: project_description,
                        notes: serialize_project_notes(&next_notes)?,
                    },
                    state.clone(),
                )?
            } else {
                snapshot.project.clone()
            };

            {
                let mut conn = connect(&state.paths)?;
                for (index, section) in sections_from_prd(&prd).iter().enumerate() {
                    ensure_command_section(
                        &mut conn,
                        target_project_id,
                        section,
                        Some(index as i32),
                    )?;
                }
            }

            for diff in &analysis.command_diffs {
                if !selected_command_indexes.contains(&diff.index) {
                    continue;
                }
                let incoming = &prd.commands[diff.index];
                match diff.status {
                    ImportDiffStatus::Identical => {}
                    ImportDiffStatus::New => {
                        let avatar_path = restore_imported_avatar(
                            incoming.avatar.as_ref(),
                            &prd.assets,
                            &state.paths,
                            "command",
                            &format!("{}-{}", target_project_id, diff.index),
                        )?;
                        let _ = create_command(
                            CommandInput {
                                project_id: target_project_id,
                                name: incoming.name.clone(),
                                script: incoming.script.clone(),
                                avatar_path,
                                ports: Some(incoming.ports.clone()),
                                section: Some(incoming.section.clone()),
                                order_index: Some(incoming.order_index),
                                runtime_mode: Some(incoming.runtime_mode.clone()),
                                run_in_external_terminal: Some(incoming.run_in_external_terminal),
                                external_terminal_kind: Some(EXTERNAL_TERMINAL_KIND_DEFAULT.to_string()),
                                interactive_terminal_kind: None,
                            },
                            state.clone(),
                        )?;
                    }
                    ImportDiffStatus::Overwrite => {
                        if let Some(command_id) = diff.matched_command_id {
                            let avatar_path = restore_imported_avatar(
                                incoming.avatar.as_ref(),
                                &prd.assets,
                                &state.paths,
                                "command",
                                &format!("{}-{}", target_project_id, command_id),
                            )?;
                            let _ = update_command(
                                command_id,
                                CommandInput {
                                project_id: target_project_id,
                                name: incoming.name.clone(),
                                script: incoming.script.clone(),
                                avatar_path,
                                ports: Some(incoming.ports.clone()),
                                section: Some(incoming.section.clone()),
                                order_index: Some(incoming.order_index),
                                runtime_mode: Some(incoming.runtime_mode.clone()),
                                run_in_external_terminal: Some(incoming.run_in_external_terminal),
                                external_terminal_kind: Some(EXTERNAL_TERMINAL_KIND_DEFAULT.to_string()),
                                interactive_terminal_kind: None,
                            },
                            state.clone(),
                        )?;
                        }
                    }
                }
            }

            let mut conn = connect(&state.paths)?;
            load_project_by_id(&mut conn, project.id)
        }
        (Some(_), Some(_)) | (Some(_), None) => Err(
            "The matching project changed while you were reviewing the import. Please reopen the .prd file and try again."
                .to_string(),
        ),
    }
}

fn normalize_legacy_prd_file(prd: LegacyPrdFile) -> NormalizedPrdFile {
    NormalizedPrdFile {
        format: prd.format,
        exported_at: prd.exported_at,
        project: NormalizedPrdProject {
            name: prd.project.name,
            path: prd.project.path,
            avatar: avatar_ref_from_path(prd.project.avatar_path),
            description: prd.project.description,
            notes: parse_project_notes(prd.project.notes.as_deref()),
        },
        commands: prd
            .commands
            .into_iter()
            .map(|command| NormalizedPrdCommand {
                name: command.name,
                script: command.script,
                avatar: avatar_ref_from_path(command.avatar_path),
                ports: command.ports,
                section: command.section,
                order_index: command.order_index,
                runtime_mode: normalize_runtime_mode(
                    command.runtime_mode.as_deref(),
                    command.run_in_external_terminal,
                ),
                run_in_external_terminal: command.run_in_external_terminal.unwrap_or(false),
            })
            .collect(),
        sections: Vec::new(),
        assets: HashMap::new(),
    }
}

fn normalize_prd_file_v2(prd: PrdFileV2) -> NormalizedPrdFile {
    NormalizedPrdFile {
        format: prd.format,
        exported_at: prd.exported_at,
        project: NormalizedPrdProject {
            name: prd.project.name,
            path: prd.project.path,
            avatar: prd.project.avatar,
            description: prd.project.description,
            notes: prd.project.notes,
        },
        commands: prd
            .commands
            .into_iter()
            .map(|command| NormalizedPrdCommand {
                name: command.name,
                script: command.script,
                avatar: command.avatar,
                ports: command.ports,
                section: command.section,
                order_index: command.order_index,
                runtime_mode: normalize_runtime_mode(
                    Some(&command.runtime_mode),
                    Some(command.run_in_external_terminal),
                ),
                run_in_external_terminal: command.run_in_external_terminal,
            })
            .collect(),
        sections: prd.sections,
        assets: prd
            .assets
            .into_iter()
            .map(|asset| (asset.id.clone(), asset))
            .collect(),
    }
}

fn read_prd_file(path: &Path) -> Result<NormalizedPrdFile, String> {
    #[derive(Deserialize)]
    struct FormatProbe {
        format: String,
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let probe: FormatProbe = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    match probe.format.as_str() {
        PRD_V1_FORMAT => {
            let prd: LegacyPrdFile =
                serde_json::from_str(&content).map_err(|error| error.to_string())?;
            Ok(normalize_legacy_prd_file(prd))
        }
        PRD_V2_FORMAT => {
            let prd: PrdFileV2 =
                serde_json::from_str(&content).map_err(|error| error.to_string())?;
            Ok(normalize_prd_file_v2(prd))
        }
        _ => Err("Unsupported .prd format".to_string()),
    }
}

fn sanitize_file_name(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => ch,
        })
        .collect::<String>();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

fn collect_prd_paths_from_args(
    args: impl IntoIterator<Item = OsString>,
    cwd: Option<&Path>,
) -> Vec<String> {
    args.into_iter()
        .filter_map(|arg| {
            let candidate = PathBuf::from(&arg);
            let extension = candidate.extension().and_then(|value| value.to_str())?;
            if !extension.eq_ignore_ascii_case("prd") {
                return None;
            }
            let resolved = if candidate.is_absolute() {
                candidate
            } else if let Some(cwd) = cwd {
                cwd.join(candidate)
            } else {
                candidate
            };
            Some(resolved.to_string_lossy().to_string())
        })
        .collect()
}

fn store_pending_prd_open_request(app: &AppHandle, file_path: String) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pending_prd_open_requests.lock() {
            if !pending.contains(&file_path) {
                pending.push(file_path);
            }
        }
    }
}

fn emit_prd_open_request(app: &AppHandle, file_path: String) {
    store_pending_prd_open_request(app, file_path.clone());
    let _ = app.emit(PRD_OPEN_EVENT, PrdOpenRequestPayload { file_path });
}

#[tauri::command]
fn take_pending_prd_open_requests(state: State<AppState>) -> Result<Vec<String>, String> {
    let mut pending = state
        .pending_prd_open_requests
        .lock()
        .map_err(|_| "Failed to read pending .prd open requests".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

fn load_command(
    conn: &mut SqliteConnection,
    command_id: i64,
) -> Result<(ProjectCommand, Project), String> {
    let command = sql_query(format!("SELECT * FROM commands WHERE id = {}", command_id))
        .load::<ProjectCommand>(conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Command not found".to_string())?;

    let project = sql_query(format!(
        "SELECT * FROM projects WHERE id = {}",
        command.project_id
    ))
    .load::<Project>(conn)
    .map_err(|error| error.to_string())?
    .into_iter()
    .next()
    .ok_or_else(|| "Project not found".to_string())?;

    Ok((command, project))
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let mut conn = connect(&state.paths)?;
    sql_query("SELECT * FROM projects ORDER BY updated_at DESC, id DESC")
        .load::<Project>(&mut conn)
        .map_err(|error| error.to_string())
}

fn project_root(project_id: i64, state: &AppState) -> Result<PathBuf, String> {
    let mut conn = connect(&state.paths)?;
    let project = sql_query(format!("SELECT * FROM projects WHERE id = {}", project_id))
        .get_result::<Project>(&mut conn)
        .map_err(|error| error.to_string())?;
    let root = PathBuf::from(project.path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("Project path is not a folder".to_string());
    }
    Ok(root)
}

fn safe_project_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid project-relative path".to_string());
    }
    let candidate = root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("Path must remain inside the project folder".to_string());
    }
    Ok(canonical)
}

fn safe_new_entry_path(
    root: &Path,
    parent_relative_path: &str,
    name: &str,
) -> Result<PathBuf, String> {
    let parent = safe_project_relative_path(root, parent_relative_path)?;
    if !parent.is_dir() {
        return Err("Destination is not a folder".to_string());
    }
    let name_path = Path::new(name.trim());
    if name_path.components().count() != 1
        || !matches!(name_path.components().next(), Some(Component::Normal(_)))
    {
        return Err("Name must not contain path separators".to_string());
    }
    let target = parent.join(name_path);
    if target.exists() {
        return Err("A file or folder with this name already exists".to_string());
    }
    Ok(target)
}

fn format_system_time(value: std::io::Result<std::time::SystemTime>) -> Option<String> {
    value
        .ok()
        .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339())
}

fn is_text_file(path: &Path, metadata: &fs::Metadata) -> bool {
    if metadata.is_dir() || metadata.len() > 32 * 1024 * 1024 {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    // Fast path: known text extensions
    if matches!(
        ext.as_str(),
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "json" | "rs" | "py" | "go" | "java"
            | "c" | "cpp" | "h" | "hpp" | "cs" | "php" | "rb" | "lua" | "sh" | "bash"
            | "zsh" | "ps1" | "bat" | "cmd" | "css" | "scss" | "sass" | "less" | "html"
            | "htm" | "xml" | "svg" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf"
            | "md" | "mdx" | "txt" | "sql" | "graphql" | "gql" | "prisma" | "env"
            | "gitignore" | "dockerignore" | "editorconfig" | "lock"
    ) {
        return true;
    }

    // Fast path: known binary extensions
    if matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" | "bmp" | "tiff" | "pdf"
            | "zip" | "tar" | "gz" | "7z" | "rar" | "bz2" | "xz" | "exe" | "dll" | "so"
            | "dylib" | "bin" | "wasm" | "mp3" | "mp4" | "wav" | "ogg" | "mov" | "avi"
            | "flv" | "mkv" | "webm" | "ttf" | "otf" | "woff" | "woff2" | "eot" | "lockb"
            | "db" | "sqlite" | "sqlite3" | "jar" | "war" | "class" | "pyc" | "pyd"
    ) {
        return false;
    }

    // Fallback: check first 4KB for null bytes
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut sample = [0_u8; 4096];
    let count = match file.read(&mut sample) {
        Ok(count) => count,
        Err(_) => return false,
    };
    !sample[..count].contains(&0)
}

fn count_text_lines(path: &Path, metadata: &fs::Metadata) -> Option<u64> {
    if metadata.len() > 1024 * 1024 {
        return None;
    }
    let mut file = fs::File::open(path).ok()?;
    let mut buffer = [0_u8; 32768];
    let mut count = 0_u64;
    let mut has_content = false;
    let mut last_byte_was_newline = false;
    loop {
        let bytes_read = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return None,
        };
        has_content = true;
        for &b in &buffer[..bytes_read] {
            if b == b'\n' {
                count += 1;
            }
        }
        last_byte_was_newline = buffer[bytes_read - 1] == b'\n';
    }
    if !has_content {
        return Some(0);
    }
    if !last_byte_was_newline {
        count += 1;
    }
    Some(count)
}

fn project_file_entry(root: &Path, path: &Path) -> Result<ProjectFileEntry, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let is_directory = metadata.is_dir();
    let mut size_bytes = metadata.len();
    let mut child_file_count = 0;
    let mut child_folder_count = 0;
    if is_directory {
        size_bytes = 0;
        if let Ok(read_dir) = fs::read_dir(path) {
            for entry in read_dir.filter_map(Result::ok) {
                if entry.file_name().to_string_lossy() == ".git" {
                    continue;
                }
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        child_folder_count += 1;
                    } else if file_type.is_file() {
                        child_file_count += 1;
                        if let Ok(child_meta) = entry.metadata() {
                            size_bytes += child_meta.len();
                        }
                    }
                }
            }
        }
    }
    let file_kind = if is_directory {
        "folder".to_string()
    } else if is_text_file(path, &metadata) {
        "text".to_string()
    } else {
        "binary".to_string()
    };
    let line_count = if file_kind == "text" {
        count_text_lines(path, &metadata)
    } else {
        None
    };
    Ok(ProjectFileEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        relative_path: path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/"),
        is_directory,
        size_bytes,
        child_file_count,
        child_folder_count,
        created_at: format_system_time(metadata.created()),
        modified_at: format_system_time(metadata.modified()),
        file_kind,
        line_count,
    })
}

fn project_file_tree_entry(root: &Path, path: &Path) -> Result<ProjectFileEntry, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let is_directory = metadata.is_dir();
    let file_kind = if is_directory {
        "folder".to_string()
    } else if is_text_file(path, &metadata) {
        "text".to_string()
    } else {
        "binary".to_string()
    };
    Ok(ProjectFileEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        relative_path: path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/"),
        is_directory,
        size_bytes: if is_directory { 0 } else { metadata.len() },
        child_file_count: 0,
        child_folder_count: 0,
        created_at: format_system_time(metadata.created()),
        modified_at: format_system_time(metadata.modified()),
        file_kind: file_kind.clone(),
        line_count: if file_kind == "text" {
            count_text_lines(path, &metadata)
        } else {
            None
        },
    })
}

struct SortedDirEntry {
    path: PathBuf,
    is_directory: bool,
    sort_key: String,
}

fn sorted_project_directory_paths(root: &Path, directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory).map_err(|error| error.to_string())?;
    for entry in read_dir.filter_map(Result::ok) {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str == ".git" {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let path = entry.path();
        if file_type.is_symlink() {
            if let Ok(canonical) = path.canonicalize() {
                if !canonical.starts_with(root) {
                    continue;
                }
            } else {
                continue;
            }
        }
        entries.push(SortedDirEntry {
            is_directory: file_type.is_dir(),
            sort_key: name_str.to_lowercase(),
            path,
        });
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.sort_key.cmp(&right.sort_key))
    });
    Ok(entries.into_iter().map(|entry| entry.path).collect())
}

#[tauri::command]
async fn list_project_files_page(
    project_id: i64,
    relative_path: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<ProjectFilePage, String> {
    let root = project_root(project_id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = safe_project_relative_path(&root, &relative_path)?;
        if !directory.is_dir() {
            return Err("Path is not a folder".to_string());
        }
        let paths = sorted_project_directory_paths(&root, &directory)?;
        let page_size = limit.clamp(1, 100);
        let has_more = offset.saturating_add(page_size) < paths.len();
        let entries = paths
            .into_iter()
            .skip(offset)
            .take(page_size)
            .filter_map(|path| project_file_tree_entry(&root, &path).ok())
            .collect();
        Ok(ProjectFilePage { entries, has_more })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_project_files(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectFileEntry>, String> {
    let root = project_root(project_id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = safe_project_relative_path(&root, &relative_path)?;
        if !directory.is_dir() {
            return Err("Path is not a folder".to_string());
        }
        let paths = sorted_project_directory_paths(&root, &directory)?;
        let entries = paths
            .into_iter()
            .filter_map(|path| project_file_entry(&root, &path).ok())
            .collect();
        Ok(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_file_info(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ProjectFileEntry, String> {
    let root = project_root(project_id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = safe_project_relative_path(&root, &relative_path)?;
        project_file_entry(&root, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_folder_size(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let root = project_root(project_id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = safe_project_relative_path(&root, &relative_path)?;
        if !path.is_dir() {
            return Err("Path is not a folder".to_string());
        }
        let mut total_bytes = 0_u64;
        let mut stack = vec![path];
        while let Some(current_dir) = stack.pop() {
            if let Ok(read_dir) = fs::read_dir(&current_dir) {
                for entry in read_dir.filter_map(Result::ok) {
                    let file_name = entry.file_name();
                    let name_str = file_name.to_string_lossy();
                    if name_str == ".git" {
                        continue;
                    }
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_symlink() {
                            continue;
                        }
                        if file_type.is_dir() {
                            stack.push(entry.path());
                        } else if file_type.is_file() {
                            if let Ok(meta) = entry.metadata() {
                                total_bytes += meta.len();
                            }
                        }
                    }
                }
            }
        }
        Ok(total_bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn project_file_exists(
    project_id: i64,
    relative_path: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let root = project_root(project_id, &state)?;
    let relative = Path::new(&relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid project-relative path".to_string());
    }
    let candidate = root.join(relative);
    if !candidate.exists() {
        return Ok(false);
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    Ok(canonical.starts_with(root))
}

#[derive(QueryableByName)]
struct StoredProjectTypeId {
    #[diesel(sql_type = Text)]
    project_type_id: String,
}

fn stored_folder_project_types(
    project_id: i64,
    relative_path: &str,
    state: &AppState,
) -> Result<Vec<String>, String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "SELECT project_type_id FROM folder_dev_project_types WHERE project_id = {} AND relative_path = '{}' ORDER BY project_type_id",
        project_id,
        quote_sql(relative_path),
    ))
    .load::<StoredProjectTypeId>(&mut conn)
    .map(|rows| rows.into_iter().map(|row| row.project_type_id).collect())
    .map_err(|error| error.to_string())
}

fn dev_folder_root(
    project_id: i64,
    relative_path: &str,
    state: &AppState,
) -> Result<(PathBuf, PathBuf), String> {
    let project_root = project_root(project_id, state)?;
    let folder_root = safe_project_relative_path(&project_root, relative_path)?;
    if !folder_root.is_dir() {
        return Err("Path is not a folder".to_string());
    }
    Ok((project_root, folder_root))
}

#[tauri::command]
fn list_dev_project_types() -> Vec<DevProjectType> {
    dev_cache::list_project_types()
}

#[tauri::command]
fn scan_dev_project_types(
    project_id: i64,
    relative_path: String,
    state: State<AppState>,
) -> Result<DevProjectTypeScan, String> {
    let (_, folder_root) = dev_folder_root(project_id, &relative_path, &state)?;
    Ok(dev_cache::scan_project_types(&folder_root))
}

#[tauri::command]
fn get_folder_dev_project_types(
    project_id: i64,
    relative_path: String,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let _ = dev_folder_root(project_id, &relative_path, &state)?;
    stored_folder_project_types(project_id, &relative_path, &state)
}

#[tauri::command]
fn set_folder_dev_project_types(
    project_id: i64,
    relative_path: String,
    project_type_ids: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let _ = dev_folder_root(project_id, &relative_path, &state)?;
    let known_ids = dev_cache::list_project_types()
        .into_iter()
        .map(|item| item.id)
        .collect::<HashSet<_>>();
    let unique_ids = project_type_ids.into_iter().collect::<BTreeSet<_>>();
    if unique_ids.iter().any(|id| !known_ids.contains(id)) {
        return Err("Unknown development project type".to_string());
    }
    let mut conn = connect(&state.paths)?;
    conn.batch_execute("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|error| error.to_string())?;
    let result = (|| {
        sql_query(format!(
            "DELETE FROM folder_dev_project_types WHERE project_id = {} AND relative_path = '{}'",
            project_id,
            quote_sql(&relative_path)
        ))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;
        let timestamp = now();
        for id in &unique_ids {
            sql_query(format!(
                "INSERT INTO folder_dev_project_types (project_id, relative_path, project_type_id, created_at, updated_at) VALUES ({}, '{}', '{}', '{}', '{}')",
                project_id, quote_sql(&relative_path), quote_sql(id), timestamp, timestamp,
            )).execute(&mut conn).map_err(|error| error.to_string())?;
        }
        Ok::<(), String>(())
    })();
    match result {
        Ok(()) => conn
            .batch_execute("COMMIT;")
            .map_err(|error| error.to_string())?,
        Err(error) => {
            let _ = conn.batch_execute("ROLLBACK;");
            return Err(error);
        }
    }
    Ok(unique_ids.into_iter().collect())
}

#[tauri::command]
async fn scan_dev_cache(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DevCacheCandidate>, String> {
    let (_, folder_root) = dev_folder_root(project_id, &relative_path, &state)?;
    let type_ids = stored_folder_project_types(project_id, &relative_path, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(dev_cache::scan_cache(&folder_root, &type_ids))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clean_dev_cache(
    project_id: i64,
    relative_path: String,
    candidate_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DevCacheCleanResult, String> {
    let (project_root, folder_root) = dev_folder_root(project_id, &relative_path, &state)?;
    let type_ids = stored_folder_project_types(project_id, &relative_path, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let folder_canonical = folder_root
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let project_canonical = project_root
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let candidates = dev_cache::scan_cache(&folder_root, &type_ids);
        let requested = candidate_ids.into_iter().collect::<HashSet<_>>();
        let mut deleted_ids = Vec::new();
        let mut failed_items = Vec::new();
        let mut freed_bytes = 0;
        for id in requested {
            let Some(candidate) = dev_cache::resolve_candidate(&candidates, &id) else {
                failed_items.push(DevCacheCleanFailure {
                    id,
                    relative_path: String::new(),
                    error: "Candidate is no longer available".to_string(),
                });
                continue;
            };
            let path = folder_root.join(&candidate.relative_path);
            let validation = (|| {
                let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err("Candidate is not a removable directory".to_string());
                }
                let canonical = path.canonicalize().map_err(|error| error.to_string())?;
                if canonical == folder_canonical
                    || !canonical.starts_with(&folder_canonical)
                    || !canonical.starts_with(&project_canonical)
                {
                    return Err("Candidate must remain inside the selected project folder".to_string());
                }
                fs::remove_dir_all(&canonical).map_err(|error| error.to_string())
            })();
            match validation {
                Ok(()) => {
                    freed_bytes += candidate.size_bytes;
                    deleted_ids.push(candidate.id.clone());
                }
                Err(error) => failed_items.push(DevCacheCleanFailure {
                    id: candidate.id.clone(),
                    relative_path: candidate.relative_path.clone(),
                    error,
                }),
            }
        }
        Ok(DevCacheCleanResult {
            deleted_ids,
            failed_items,
            freed_bytes,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn create_project_file(
    project_id: i64,
    parent_relative_path: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let target = safe_new_entry_path(&root, &parent_relative_path, &name)?;
    fs::File::create(target)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_project_folder(
    project_id: i64,
    parent_relative_path: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let target = safe_new_entry_path(&root, &parent_relative_path, &name)?;
    fs::create_dir(target).map_err(|error| error.to_string())
}

fn copy_path(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir(target).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_path(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        fs::copy(source, target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn paste_project_file(
    project_id: i64,
    source_relative_path: String,
    target_relative_path: String,
    cut: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let source = safe_project_relative_path(&root, &source_relative_path)?;
    let target_folder = safe_project_relative_path(&root, &target_relative_path)?;
    if !target_folder.is_dir() {
        return Err("Paste target is not a folder".to_string());
    }
    if source.is_dir() && target_folder.starts_with(&source) {
        return Err("Cannot paste a folder inside itself".to_string());
    }
    let target = target_folder.join(
        source
            .file_name()
            .ok_or_else(|| "Invalid source".to_string())?,
    );
    if target.exists() {
        return Err("An item with this name already exists".to_string());
    }
    if cut {
        fs::rename(source, target).map_err(|error| error.to_string())
    } else {
        copy_path(&source, &target)
    }
}

#[tauri::command]
fn rename_project_file(
    project_id: i64,
    relative_path: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let source = safe_project_relative_path(&root, &relative_path)?;
    let parent_relative = Path::new(&relative_path)
        .parent()
        .and_then(Path::to_str)
        .unwrap_or("");
    let target = safe_new_entry_path(&root, parent_relative, &name)?;
    fs::rename(source, &target).map_err(|error| error.to_string())?;
    let target_relative = target
        .strip_prefix(&root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "UPDATE folder_dev_project_types SET relative_path = '{}' || substr(relative_path, {}), updated_at = '{}' WHERE project_id = {} AND (relative_path = '{}' OR substr(relative_path, 1, {}) = '{}/')",
        quote_sql(&target_relative), relative_path.len() + 1, now(), project_id, quote_sql(&relative_path), relative_path.len() + 1, quote_sql(&relative_path),
    )).execute(&mut conn).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_project_file(
    project_id: i64,
    relative_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let target = safe_project_relative_path(&root, &relative_path)?;
    if target == root {
        return Err("The project root cannot be deleted".to_string());
    }
    if target.is_dir() {
        fs::remove_dir_all(target)
    } else {
        fs::remove_file(target)
    }
    .map_err(|error| error.to_string())?;
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "DELETE FROM folder_dev_project_types WHERE project_id = {} AND (relative_path = '{}' OR substr(relative_path, 1, {}) = '{}/')",
        project_id, quote_sql(&relative_path), relative_path.len() + 1, quote_sql(&relative_path),
    )).execute(&mut conn).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn reveal_project_file(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let path = safe_project_relative_path(&root, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("explorer.exe");
            if path.is_file() {
                command.arg(format!("/select,{}", path.to_string_lossy()));
            } else {
                command.arg(path);
            }
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("open");
            command.arg(path);
            command
        };
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = {
            let mut command = Command::new("xdg-open");
            command.arg(path);
            command
        };
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_project_file(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = project_root(project_id, &state)?;
    let path = safe_project_relative_path(&root, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let mut command = {
            let path_string = path.to_string_lossy().to_string();
            let mut command = Command::new("cmd");
            command.args(["/C", "start", "", &path_string]);
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("open");
            command.arg(path);
            command
        };
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = {
            let mut command = Command::new("xdg-open");
            command.arg(path);
            command
        };
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_project_file(
    project_id: i64,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ProjectFileContent, String> {
    let root = project_root(project_id, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = safe_project_relative_path(&root, &relative_path)?;
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            return Err("Folders cannot be viewed".to_string());
        }
        if metadata.len() > 20 * 1024 * 1024 {
            return Err("Files larger than 20 MB cannot be viewed".to_string());
        }
        let mime = MimeGuess::from_path(&path).first_or_octet_stream();
        if mime.type_().as_str() == "image" {
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            return Ok(ProjectFileContent {
                file_kind: "image".to_string(),
                content: None,
                data_url: Some(format!(
                    "data:{};base64,{}",
                    mime.essence_str(),
                    BASE64_STANDARD.encode(bytes)
                )),
            });
        }
        if !is_text_file(&path, &metadata) {
            return Err("This binary file cannot be viewed internally".to_string());
        }
        Ok(ProjectFileContent {
            file_kind: "text".to_string(),
            content: Some(fs::read_to_string(path).map_err(|error| error.to_string())?),
            data_url: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn create_project(input: ProjectInput, state: State<AppState>) -> Result<Project, String> {
    let mut conn = connect(&state.paths)?;
    let timestamp = now();
    sql_query(format!(
        "INSERT INTO projects (name, path, avatar_path, description, notes, created_at, updated_at)
         VALUES ('{}', '{}', {}, {}, {}, '{}', '{}')",
        quote_sql(&input.name),
        quote_sql(&input.path),
        optional_sql(&input.avatar_path),
        optional_sql(&input.description),
        optional_sql(&input.notes),
        timestamp,
        timestamp
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    let project = sql_query("SELECT * FROM projects WHERE id = last_insert_rowid()")
        .get_result::<Project>(&mut conn)
        .map_err(|error| error.to_string())?;
    ensure_command_section(&mut conn, project.id, "General", Some(-1))?;
    Ok(project)
}

#[tauri::command]
fn update_project(id: i64, input: ProjectInput, state: State<AppState>) -> Result<Project, String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "UPDATE projects SET name = '{}', path = '{}', avatar_path = {}, description = {}, notes = {}, updated_at = '{}' WHERE id = {}",
        quote_sql(&input.name),
        quote_sql(&input.path),
        optional_sql(&input.avatar_path),
        optional_sql(&input.description),
        optional_sql(&input.notes),
        now(),
        id
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(format!("SELECT * FROM projects WHERE id = {}", id))
        .get_result::<Project>(&mut conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_project(id: i64, state: State<AppState>) -> Result<(), String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!("DELETE FROM projects WHERE id = {}", id))
        .execute(&mut conn)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_commands(project_id: i64, state: State<AppState>) -> Result<Vec<ProjectCommand>, String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "SELECT * FROM commands WHERE project_id = {} ORDER BY order_index ASC, id ASC",
        project_id
    ))
    .load::<ProjectCommand>(&mut conn)
    .map_err(|error| error.to_string())
}

fn load_command_section(
    conn: &mut SqliteConnection,
    project_id: i64,
    name: &str,
) -> Result<Option<CommandSection>, String> {
    sql_query(format!(
        "SELECT * FROM command_sections WHERE project_id = {} AND name = '{}' COLLATE NOCASE",
        project_id,
        quote_sql(name)
    ))
    .get_result::<CommandSection>(conn)
    .optional()
    .map_err(|error| error.to_string())
}

fn ensure_command_section(
    conn: &mut SqliteConnection,
    project_id: i64,
    name: &str,
    order_index: Option<i32>,
) -> Result<CommandSection, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Section name is required".to_string());
    }
    if let Some(section) = load_command_section(conn, project_id, clean_name)? {
        return Ok(section);
    }
    let project_exists = sql_query(format!("SELECT * FROM projects WHERE id = {}", project_id))
        .get_result::<Project>(conn)
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if !project_exists {
        return Err("Project not found".to_string());
    }
    #[derive(QueryableByName)]
    struct NextOrder {
        #[diesel(sql_type = Integer)]
        value: i32,
    }
    let next_order = match order_index {
        Some(value) => value,
        None => sql_query(format!(
            "SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM command_sections WHERE project_id = {}",
            project_id
        ))
        .get_result::<NextOrder>(conn)
        .map_err(|error| error.to_string())?
        .value,
    };
    let timestamp = now();
    sql_query(format!(
        "INSERT INTO command_sections (project_id, name, order_index, created_at, updated_at)
         VALUES ({}, '{}', {}, '{}', '{}')",
        project_id,
        quote_sql(clean_name),
        next_order,
        timestamp,
        timestamp
    ))
    .execute(conn)
    .map_err(|error| error.to_string())?;
    load_command_section(conn, project_id, clean_name)?
        .ok_or_else(|| "Unable to create section".to_string())
}

#[tauri::command]
fn list_command_sections(
    project_id: i64,
    state: State<AppState>,
) -> Result<Vec<CommandSection>, String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "SELECT * FROM command_sections WHERE project_id = {} ORDER BY order_index ASC, id ASC",
        project_id
    ))
    .load::<CommandSection>(&mut conn)
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_command_section(
    input: CommandSectionInput,
    state: State<AppState>,
) -> Result<CommandSection, String> {
    let mut conn = connect(&state.paths)?;
    if load_command_section(&mut conn, input.project_id, input.name.trim())?.is_some() {
        return Err(format!("Section \"{}\" already exists.", input.name.trim()));
    }
    ensure_command_section(&mut conn, input.project_id, &input.name, input.order_index)
}

#[tauri::command]
fn rename_command_section(
    id: i64,
    input: CommandSectionUpdateInput,
    state: State<AppState>,
) -> Result<CommandSection, String> {
    rename_command_section_in_conn(&mut connect(&state.paths)?, id, &input.name)
}

fn rename_command_section_in_conn(
    conn: &mut SqliteConnection,
    id: i64,
    name: &str,
) -> Result<CommandSection, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Section name is required".to_string());
    }
    let current = sql_query(format!("SELECT * FROM command_sections WHERE id = {}", id))
        .get_result::<CommandSection>(conn)
        .map_err(|error| error.to_string())?;
    if current.name.eq_ignore_ascii_case("General") && !clean_name.eq_ignore_ascii_case("General") {
        return Err("The General section cannot be renamed.".to_string());
    }
    if let Some(existing) = load_command_section(conn, current.project_id, clean_name)? {
        if existing.id != id {
            return Err(format!("Section \"{}\" already exists.", clean_name));
        }
    }
    conn.batch_execute("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        let timestamp = now();
        sql_query(format!(
            "UPDATE command_sections SET name = '{}', updated_at = '{}' WHERE id = {}",
            quote_sql(clean_name),
            timestamp,
            id
        ))
        .execute(&mut *conn)
        .map_err(|error| error.to_string())?;
        sql_query(format!(
            "UPDATE commands SET section = '{}', updated_at = '{}' WHERE project_id = {} AND section = '{}' COLLATE NOCASE",
            quote_sql(clean_name),
            timestamp,
            current.project_id,
            quote_sql(&current.name)
        ))
        .execute(&mut *conn)
        .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = conn.batch_execute("ROLLBACK;");
        return Err(error);
    }
    conn.batch_execute("COMMIT;")
        .map_err(|error| error.to_string())?;
    sql_query(format!("SELECT * FROM command_sections WHERE id = {}", id))
        .get_result::<CommandSection>(conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_command_section(id: i64, state: State<AppState>) -> Result<(), String> {
    delete_command_section_in_conn(&mut connect(&state.paths)?, id)
}

fn delete_command_section_in_conn(conn: &mut SqliteConnection, id: i64) -> Result<(), String> {
    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = BigInt)]
        count: i64,
    }
    let section = sql_query(format!("SELECT * FROM command_sections WHERE id = {}", id))
        .get_result::<CommandSection>(conn)
        .map_err(|error| error.to_string())?;
    if section.name.eq_ignore_ascii_case("General") {
        return Err("The General section cannot be deleted.".to_string());
    }
    let command_count = sql_query(format!(
        "SELECT COUNT(*) AS count FROM commands WHERE project_id = {} AND section = '{}' COLLATE NOCASE",
        section.project_id,
        quote_sql(&section.name)
    ))
    .get_result::<CountRow>(&mut *conn)
    .map_err(|error| error.to_string())?
    .count;
    if command_count > 0 {
        return Err("Only empty sections can be deleted.".to_string());
    }
    sql_query(format!("DELETE FROM command_sections WHERE id = {}", id))
        .execute(conn)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn load_flow_detail(conn: &mut SqliteConnection, id: i64) -> Result<FlowDetail, String> {
    let flow = sql_query(format!("SELECT * FROM flows WHERE id = {}", id))
        .get_result::<Flow>(conn)
        .map_err(|error| error.to_string())?;
    let nodes = sql_query(format!(
        "SELECT * FROM flow_nodes WHERE flow_id = {} ORDER BY id ASC",
        id
    ))
    .load::<FlowNode>(conn)
    .map_err(|error| error.to_string())?;
    let edges = sql_query(format!(
        "SELECT * FROM flow_edges WHERE flow_id = {} ORDER BY id ASC",
        id
    ))
    .load::<FlowEdge>(conn)
    .map_err(|error| error.to_string())?;
    Ok(FlowDetail { flow, nodes, edges })
}

fn validate_flow_graph(nodes: &[FlowNodeInput], edges: &[FlowEdgeInput]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for node in nodes {
        if node.id.trim().is_empty() || !ids.insert(node.id.as_str()) {
            return Err("Each flow node needs a unique id".to_string());
        }
    }
    if nodes.is_empty() {
        return if edges.is_empty() {
            Ok(())
        } else {
            Err("An empty flow cannot have connections".to_string())
        };
    }
    let mut incoming = HashMap::<&str, usize>::new();
    let mut outgoing = HashMap::<&str, Vec<&str>>::new();
    let mut edge_ids = HashSet::new();
    let mut connected_pairs = HashSet::new();
    for edge in edges {
        if edge.id.trim().is_empty() || !edge_ids.insert(edge.id.as_str()) {
            return Err("Each connection needs a unique id".to_string());
        }
        if edge.source_node_id == edge.target_node_id
            || !ids.contains(edge.source_node_id.as_str())
            || !ids.contains(edge.target_node_id.as_str())
        {
            return Err("Connections must join two different nodes in this flow".to_string());
        }
        let pair = if edge.source_node_id < edge.target_node_id {
            (edge.source_node_id.as_str(), edge.target_node_id.as_str())
        } else {
            (edge.target_node_id.as_str(), edge.source_node_id.as_str())
        };
        if !connected_pairs.insert(pair) {
            return Err("Only one connection can exist between a pair of flow nodes".to_string());
        }
        *incoming.entry(edge.target_node_id.as_str()).or_insert(0) += 1;
        outgoing
            .entry(edge.source_node_id.as_str())
            .or_default()
            .push(edge.target_node_id.as_str());
    }
    let mut ready = ids
        .iter()
        .copied()
        .filter(|id| !incoming.contains_key(*id))
        .collect::<Vec<_>>();
    let mut visited = 0;
    while let Some(current) = ready.pop() {
        visited += 1;
        for next in outgoing.get(current).into_iter().flatten() {
            let degree = incoming
                .get_mut(next)
                .expect("target node must have an incoming edge");
            *degree -= 1;
            if *degree == 0 {
                ready.push(next);
            }
        }
    }
    if visited != nodes.len() {
        return Err("The flow contains a cycle".to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_flows(project_id: i64, state: State<AppState>) -> Result<Vec<FlowSummary>, String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "SELECT f.id, f.project_id, f.name, f.created_at, f.updated_at, COUNT(n.id) AS node_count
         FROM flows f LEFT JOIN flow_nodes n ON n.flow_id = f.id
         WHERE f.project_id = {} GROUP BY f.id ORDER BY f.updated_at DESC, f.id DESC",
        project_id
    ))
    .load::<FlowSummary>(&mut conn)
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_flow(id: i64, state: State<AppState>) -> Result<FlowDetail, String> {
    load_flow_detail(&mut connect(&state.paths)?, id)
}

#[tauri::command]
fn create_flow(input: FlowInput, state: State<AppState>) -> Result<Flow, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Flow name is required".to_string());
    }
    let mut conn = connect(&state.paths)?;
    let exists = sql_query(format!(
        "SELECT * FROM projects WHERE id = {}",
        input.project_id
    ))
    .get_result::<Project>(&mut conn)
    .optional()
    .map_err(|error| error.to_string())?;
    if exists.is_none() {
        return Err("Project not found".to_string());
    }
    let timestamp = now();
    sql_query(format!("INSERT INTO flows (project_id, name, created_at, updated_at) VALUES ({}, '{}', '{}', '{}')", input.project_id, quote_sql(name), timestamp, timestamp))
        .execute(&mut conn).map_err(|error| error.to_string())?;
    sql_query("SELECT * FROM flows WHERE id = last_insert_rowid()")
        .get_result::<Flow>(&mut conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_flow(id: i64, input: FlowUpdateInput, state: State<AppState>) -> Result<Flow, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Flow name is required".to_string());
    }
    let mut conn = connect(&state.paths)?;
    sql_query(format!(
        "UPDATE flows SET name = '{}', updated_at = '{}' WHERE id = {}",
        quote_sql(name),
        now(),
        id
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!("SELECT * FROM flows WHERE id = {}", id))
        .get_result::<Flow>(&mut conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_flow_graph(
    id: i64,
    input: FlowGraphInput,
    state: State<AppState>,
) -> Result<FlowDetail, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Flow name is required".to_string());
    }
    validate_flow_graph(&input.nodes, &input.edges)?;
    let mut conn = connect(&state.paths)?;
    let flow = sql_query(format!("SELECT * FROM flows WHERE id = {}", id))
        .get_result::<Flow>(&mut conn)
        .map_err(|error| error.to_string())?;
    for node in &input.nodes {
        let command = sql_query(format!(
            "SELECT * FROM commands WHERE id = {}",
            node.command_id
        ))
        .get_result::<ProjectCommand>(&mut conn)
        .optional()
        .map_err(|error| error.to_string())?;
        if command.map(|command| command.project_id) != Some(flow.project_id) {
            return Err("All flow commands must belong to the project".to_string());
        }
    }
    conn.batch_execute("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        sql_query(format!("DELETE FROM flow_edges WHERE flow_id = {}", id))
            .execute(&mut conn)
            .map_err(|error| error.to_string())?;
        sql_query(format!("DELETE FROM flow_nodes WHERE flow_id = {}", id))
            .execute(&mut conn)
            .map_err(|error| error.to_string())?;
        for node in &input.nodes {
            sql_query(format!("INSERT INTO flow_nodes (id, flow_id, command_id, position_x, position_y) VALUES ('{}', {}, {}, {}, {})", quote_sql(&node.id), id, node.command_id, node.position_x, node.position_y)).execute(&mut conn).map_err(|error| error.to_string())?;
        }
        for edge in &input.edges {
            sql_query(format!("INSERT INTO flow_edges (id, flow_id, source_node_id, target_node_id) VALUES ('{}', {}, '{}', '{}')", quote_sql(&edge.id), id, quote_sql(&edge.source_node_id), quote_sql(&edge.target_node_id))).execute(&mut conn).map_err(|error| error.to_string())?;
        }
        sql_query(format!(
            "UPDATE flows SET name = '{}', updated_at = '{}' WHERE id = {}",
            quote_sql(name),
            now(),
            id
        ))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = conn.batch_execute("ROLLBACK;");
        return Err(error);
    }
    conn.batch_execute("COMMIT;")
        .map_err(|error| error.to_string())?;
    load_flow_detail(&mut conn, id)
}

#[tauri::command]
fn delete_flow(id: i64, state: State<AppState>) -> Result<(), String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!("DELETE FROM flows WHERE id = {}", id))
        .execute(&mut conn)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_flow_node(
    flow_id: i64,
    flow_node_id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<AppState>,
) -> Result<FlowNodeRunStart, String> {
    let mut conn = connect(&state.paths)?;
    let node = sql_query(format!(
        "SELECT * FROM flow_nodes WHERE id = '{}' AND flow_id = {}",
        quote_sql(&flow_node_id),
        flow_id
    ))
    .get_result::<FlowNode>(&mut conn)
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "Flow node not found".to_string())?;
    let flow = sql_query(format!("SELECT * FROM flows WHERE id = {}", flow_id))
        .get_result::<Flow>(&mut conn)
        .map_err(|error| error.to_string())?;
    let (command, _) = load_command(&mut conn, node.command_id)?;
    if command.project_id != flow.project_id {
        return Err("The flow node command does not belong to this project".to_string());
    }
    drop(conn);

    if command.runtime_mode == RUNTIME_MODE_INTERNAL_INTERACTIVE {
        let session = start_interactive_command_instance(
            command.id,
            Some(&node.id),
            cols,
            rows,
            &app,
            &state,
        )?;
        let run = sql_query(format!(
            "SELECT * FROM command_runs WHERE id = {}",
            session.run_id
        ))
        .get_result::<CommandRun>(&mut connect(&state.paths)?)
        .map_err(|error| error.to_string())?;
        Ok(FlowNodeRunStart {
            run,
            interactive_session: Some(session),
        })
    } else {
        let run = start_non_interactive_command(command.id, Some(&node.id), &app, &state)?;
        Ok(FlowNodeRunStart {
            run,
            interactive_session: None,
        })
    }
}

#[tauri::command]
fn create_command(input: CommandInput, state: State<AppState>) -> Result<ProjectCommand, String> {
    let mut conn = connect(&state.paths)?;
    let timestamp = now();
    let order_index = input.order_index.unwrap_or(0);
    let ports = ports_to_json(&input.ports.unwrap_or_default())?;
    let section_name = clean_section(input.section);
    let section = ensure_command_section(&mut conn, input.project_id, &section_name, None)?.name;
    let runtime_mode = normalize_runtime_mode(
        input.runtime_mode.as_deref(),
        input.run_in_external_terminal,
    );
    let external_terminal_kind =
        normalize_external_terminal_kind(input.external_terminal_kind.as_deref());
    let interactive_terminal_kind =
        normalize_interactive_terminal_kind(input.interactive_terminal_kind.as_deref());
    let run_in_external_terminal = if runtime_mode_uses_external_terminal(&runtime_mode) {
        1
    } else {
        0
    };
    sql_query(format!(
        "INSERT INTO commands (project_id, name, script, avatar_path, ports, section, order_index, runtime_mode, run_in_external_terminal, external_terminal_kind, interactive_terminal_kind, created_at, updated_at)
         VALUES ({}, '{}', '{}', {}, '{}', '{}', {}, '{}', {}, '{}', '{}', '{}', '{}')",
        input.project_id,
        quote_sql(&input.name),
        quote_sql(&input.script),
        optional_sql(&input.avatar_path),
        quote_sql(&ports),
        quote_sql(&section),
        order_index,
        quote_sql(&runtime_mode),
        run_in_external_terminal,
        quote_sql(&external_terminal_kind),
        quote_sql(&interactive_terminal_kind),
        timestamp,
        timestamp
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query("SELECT * FROM commands WHERE id = last_insert_rowid()")
        .get_result::<ProjectCommand>(&mut conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_command(
    id: i64,
    input: CommandInput,
    state: State<AppState>,
) -> Result<ProjectCommand, String> {
    let mut conn = connect(&state.paths)?;
    let order_index = input.order_index.unwrap_or(0);
    let ports = ports_to_json(&input.ports.unwrap_or_default())?;
    let section_name = clean_section(input.section);
    let section = ensure_command_section(&mut conn, input.project_id, &section_name, None)?.name;
    let runtime_mode = normalize_runtime_mode(
        input.runtime_mode.as_deref(),
        input.run_in_external_terminal,
    );
    let external_terminal_kind =
        normalize_external_terminal_kind(input.external_terminal_kind.as_deref());
    let interactive_terminal_kind =
        normalize_interactive_terminal_kind(input.interactive_terminal_kind.as_deref());
    let run_in_external_terminal = if runtime_mode_uses_external_terminal(&runtime_mode) {
        1
    } else {
        0
    };
    sql_query(format!(
        "UPDATE commands SET project_id = {}, name = '{}', script = '{}', avatar_path = {}, ports = '{}', section = '{}', order_index = {}, runtime_mode = '{}', run_in_external_terminal = {}, external_terminal_kind = '{}', interactive_terminal_kind = '{}', updated_at = '{}' WHERE id = {}",
        input.project_id,
        quote_sql(&input.name),
        quote_sql(&input.script),
        optional_sql(&input.avatar_path),
        quote_sql(&ports),
        quote_sql(&section),
        order_index,
        quote_sql(&runtime_mode),
        run_in_external_terminal,
        quote_sql(&external_terminal_kind),
        quote_sql(&interactive_terminal_kind),
        now(),
        id
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;

    sql_query(format!("SELECT * FROM commands WHERE id = {}", id))
        .get_result::<ProjectCommand>(&mut conn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_command(id: i64, state: State<AppState>) -> Result<(), String> {
    let mut conn = connect(&state.paths)?;
    sql_query(format!("DELETE FROM commands WHERE id = {}", id))
        .execute(&mut conn)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_project_folder() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn show_project_in_explorer(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_path = PathBuf::from(path);
        if !project_path.exists() {
            return Err("Project path does not exist".to_string());
        }
        if !project_path.is_dir() {
            return Err("Project path is not a folder".to_string());
        }

        #[cfg(target_os = "windows")]
        let mut command = {
            let mut cmd = Command::new("explorer.exe");
            cmd.arg(project_path);
            cmd
        };

        #[cfg(target_os = "macos")]
        let mut command = {
            let mut cmd = Command::new("open");
            cmd.arg(project_path);
            cmd
        };

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = {
            let mut cmd = Command::new("xdg-open");
            cmd.arg(project_path);
            cmd
        };

        command
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_in_external_terminal(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_path = PathBuf::from(path);
        if !project_path.exists() {
            return Err("Project path does not exist".to_string());
        }
        if !project_path.is_dir() {
            return Err("Project path is not a folder".to_string());
        }

        #[cfg(target_os = "windows")]
        let mut command = {
            let mut cmd = Command::new("cmd.exe");
            cmd.args(["/c", "start"]);
            configure_command(&mut cmd);
            cmd
        };

        #[cfg(target_os = "macos")]
        let mut command = {
            let mut cmd = Command::new("open");
            cmd.args(["-a", "Terminal"]);
            cmd
        };

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = build_linux_open_terminal_command(&project_path)?;

        command
            .current_dir(project_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
fn pick_and_copy_avatar(
    kind: String,
    owner_id: Option<i64>,
    state: State<AppState>,
) -> Result<Option<String>, String> {
    let Some(source) = rfd::FileDialog::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file()
    else {
        return Ok(None);
    };

    fs::create_dir_all(&state.paths.avatars_dir).map_err(|error| error.to_string())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let owner = owner_id
        .map(|value| value.to_string())
        .unwrap_or_else(|| "new".to_string());
    let file_name = format!("{}-{}-{}.{}", kind, owner, Uuid::new_v4(), extension);
    let target = state.paths.avatars_dir.join(file_name);
    fs::copy(&source, &target).map_err(|error| error.to_string())?;
    Ok(Some(target.to_string_lossy().to_string()))
}

#[tauri::command]
fn run_command(
    command_id: i64,
    app: AppHandle,
    state: State<AppState>,
) -> Result<CommandRun, String> {
    start_non_interactive_command(command_id, None, &app, &state)
}

fn start_non_interactive_command(
    command_id: i64,
    flow_node_id: Option<&str>,
    app: &AppHandle,
    state: &AppState,
) -> Result<CommandRun, String> {
    let mut conn = connect(&state.paths)?;
    mark_stale_running_runs(&mut conn, &state)?;
    let active_query = match flow_node_id {
        Some(node_id) => format!(
            "SELECT * FROM command_runs WHERE flow_node_id = '{}' AND status = 'running'",
            quote_sql(node_id)
        ),
        None => format!(
            "SELECT * FROM command_runs WHERE command_id = {} AND status = 'running'",
            command_id
        ),
    };
    let active_runs = sql_query(active_query)
        .load::<CommandRun>(&mut conn)
        .map_err(|error| error.to_string())?;
    if !active_runs.is_empty() {
        return Err("This command is already running".to_string());
    }

    let (command, project) = load_command(&mut conn, command_id)?;
    let project_path = PathBuf::from(&project.path);
    if !project_path.exists() {
        return Err("Project path does not exist".to_string());
    }

    if command.runtime_mode == RUNTIME_MODE_INTERNAL_INTERACTIVE {
        return Err(
            "This command uses the interactive terminal. Start it with the interactive runtime API."
                .to_string(),
        );
    }

    fs::create_dir_all(&state.paths.scripts_dir).map_err(|error| error.to_string())?;
    let script_path = write_script(&state.paths.scripts_dir, &command.script)?;
    let started_at = now();
    sql_query(format!(
        "UPDATE commands SET run_count = COALESCE(run_count, 0) + 1, updated_at = '{}' WHERE id = {}",
        started_at, command_id
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!(
        "INSERT INTO command_runs (command_id, flow_node_id, status, started_at) VALUES ({}, {}, 'running', '{}')",
        command_id, optional_sql(&flow_node_id.map(str::to_string)), started_at
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    let run = sql_query("SELECT * FROM command_runs WHERE id = last_insert_rowid()")
        .get_result::<CommandRun>(&mut conn)
        .map_err(|error| error.to_string())?;
    let run_in_external_terminal = runtime_mode_uses_external_terminal(&command.runtime_mode);
    let mut child = match build_process(
        &script_path,
        &project_path,
        run_in_external_terminal,
        &command.external_terminal_kind,
    ) {
        Ok(child) => child,
        Err(error) => {
            let ended_at = now();
            let _ = sql_query(format!(
                "UPDATE command_runs SET status = 'failed', ended_at = '{}', exit_code = NULL WHERE id = {}",
                ended_at, run.id
            ))
            .execute(&mut conn);
            let _ = fs::remove_file(&script_path);
            return Err(error);
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let process = Arc::new(RunProcess {
        pid: child.id(),
        child: Mutex::new(child),
    });

    state
        .processes
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?
        .insert(run.id, process.clone());

    let _ = app.emit(
        "command://started",
        RunStartedPayload {
            run_id: run.id,
            command_id,
            flow_node_id: run.flow_node_id.clone(),
            started_at: run.started_at.clone(),
        },
    );

    if let Some(stdout) = stdout {
        spawn_output_reader(
            app.clone(),
            run.id,
            command_id,
            run.flow_node_id.clone(),
            stdout,
            "command://stdout",
        );
    }
    if let Some(stderr) = stderr {
        spawn_output_reader(
            app.clone(),
            run.id,
            command_id,
            run.flow_node_id.clone(),
            stderr,
            "command://stderr",
        );
    }

    let paths = state.paths.clone();
    let app_for_wait = app.clone();
    let flow_node_id = run.flow_node_id.clone();
    std::thread::spawn(move || {
        let status = process
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok());
        let exit_code = status.and_then(|status| status.code());
        let was_stopped = app_for_wait
            .try_state::<AppState>()
            .and_then(|state| {
                state
                    .stopped_runs
                    .lock()
                    .ok()
                    .map(|mut stopped_runs| stopped_runs.remove(&run.id))
            })
            .unwrap_or(false);
        let final_status = if was_stopped {
            "stopped"
        } else if exit_code == Some(0) {
            "exited"
        } else {
            "failed"
        };
        let ended_at = now();

        if let Ok(mut conn) = connect(&paths) {
            let _ = sql_query(format!(
                "UPDATE command_runs SET status = '{}', ended_at = '{}', exit_code = {} WHERE id = {}",
                final_status,
                ended_at,
                exit_code.map(|code| code.to_string()).unwrap_or_else(|| "NULL".to_string()),
                run.id
            ))
            .execute(&mut conn);
        }

        if let Some(state) = app_for_wait.try_state::<AppState>() {
            if let Ok(mut processes) = state.processes.lock() {
                processes.remove(&run.id);
            }
        }

        let _ = fs::remove_file(&script_path);
        let _ = app_for_wait.emit(
            "command://finished",
            RunFinishedPayload {
                run_id: run.id,
                command_id,
                flow_node_id: flow_node_id.clone(),
                status: final_status.to_string(),
                exit_code,
                ended_at,
            },
        );
    });

    Ok(run)
}

#[tauri::command]
async fn restart_command(
    command_id: i64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandRun, String> {
    let mut conn = connect(&state.paths)?;
    mark_stale_running_runs(&mut conn, &state)?;

    let (command, _) = load_command(&mut conn, command_id)?;
    if command.runtime_mode == RUNTIME_MODE_INTERNAL_INTERACTIVE {
        return Err(
            "This command uses the interactive terminal. Restart it with the interactive runtime API."
                .to_string(),
        );
    }

    let active_run = sql_query(format!(
        "SELECT * FROM command_runs WHERE command_id = {} AND status = 'running' ORDER BY id DESC LIMIT 1",
        command_id
    ))
    .get_result::<CommandRun>(&mut conn)
    .optional()
    .map_err(|error| error.to_string())?;

    if let Some(run) = active_run {
        let process = state
            .processes
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .get(&run.id)
            .cloned();

        if let Some(process) = process {
            state
                .stopped_runs
                .lock()
                .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
                .insert(run.id);
            let stop_result =
                tauri::async_runtime::spawn_blocking(move || stop_run_process(process))
                    .await
                    .map_err(|err| err.to_string())?;
            if let Err(error) = stop_result {
                state
                    .stopped_runs
                    .lock()
                    .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
                    .remove(&run.id);
                return Err(error);
            }

            for _ in 0..80 {
                let still_running = state
                    .processes
                    .lock()
                    .map_err(|_| "Process registry lock poisoned".to_string())?
                    .contains_key(&run.id);
                if !still_running {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        } else {
            let ended_at = now();
            sql_query(format!(
                "UPDATE command_runs SET status = 'stopped', ended_at = '{}' WHERE id = {} AND status = 'running'",
                ended_at, run.id
            ))
            .execute(&mut conn)
            .map_err(|error| error.to_string())?;
            let _ = app.emit(
                "command://finished",
                RunFinishedPayload {
                    run_id: run.id,
                    command_id: run.command_id,
                    flow_node_id: run.flow_node_id.clone(),
                    status: "stopped".to_string(),
                    exit_code: None,
                    ended_at,
                },
            );
        }
    }

    start_non_interactive_command(command_id, None, &app, &state)
}

#[cfg(target_os = "windows")]
fn configure_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}
#[cfg(not(target_os = "windows"))]
fn configure_command(_cmd: &mut Command) {}

#[tauri::command]
async fn stop_command(
    run_id: i64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StopCommandResult, String> {
    let process = state
        .processes
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?
        .get(&run_id)
        .cloned();

    // A process can finish in the small gap between the UI rendering its
    // running state and the user pressing Stop/Restart. Treat that as an
    // already-completed stop rather than surfacing a spurious error.
    let Some(process) = process else {
        let mut conn = connect(&state.paths)?;
        let ended_at = now();
        let run = sql_query(format!("SELECT * FROM command_runs WHERE id = {}", run_id))
            .get_result::<CommandRun>(&mut conn)
            .optional()
            .map_err(|error| error.to_string())?;
        sql_query(format!(
            "UPDATE command_runs SET status = 'stopped', ended_at = '{}' WHERE id = {} AND status = 'running'",
            ended_at, run_id
        ))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;
        if let Some(run) = run.filter(|run| run.status == "running") {
            let _ = app.emit(
                "command://finished",
                RunFinishedPayload {
                    run_id,
                    command_id: run.command_id,
                    flow_node_id: run.flow_node_id.clone(),
                    status: "stopped".to_string(),
                    exit_code: None,
                    ended_at: ended_at.clone(),
                },
            );
        }
        return Ok(StopCommandResult { was_active: false });
    };

    state
        .stopped_runs
        .lock()
        .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
        .insert(run_id);
    let stop_result = tauri::async_runtime::spawn_blocking(move || stop_run_process(process))
        .await
        .map_err(|err| err.to_string())?;
    if let Err(error) = stop_result {
        state
            .stopped_runs
            .lock()
            .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
            .remove(&run_id);
        return Err(error);
    }
    Ok(StopCommandResult { was_active: true })
}

#[derive(serde::Serialize)]
struct StopCommandResult {
    was_active: bool,
}

#[tauri::command]
fn start_interactive_command(
    command_id: i64,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<AppState>,
) -> Result<InteractiveSessionInfo, String> {
    start_interactive_command_instance(command_id, None, cols, rows, &app, &state)
}

fn start_interactive_command_instance(
    command_id: i64,
    flow_node_id: Option<&str>,
    cols: u16,
    rows: u16,
    app: &AppHandle,
    state: &AppState,
) -> Result<InteractiveSessionInfo, String> {
    let mut conn = connect(&state.paths)?;
    mark_stale_running_runs(&mut conn, &state)?;

    let active_query = match flow_node_id {
        Some(node_id) => format!(
            "SELECT * FROM command_runs WHERE flow_node_id = '{}' AND status = 'running'",
            quote_sql(node_id)
        ),
        None => format!(
            "SELECT * FROM command_runs WHERE command_id = {} AND status = 'running'",
            command_id
        ),
    };
    let active_runs = sql_query(active_query)
        .load::<CommandRun>(&mut conn)
        .map_err(|error| error.to_string())?;
    if !active_runs.is_empty() {
        return Err("This command is already running".to_string());
    }

    let (command, project) = load_command(&mut conn, command_id)?;
    if command.runtime_mode != RUNTIME_MODE_INTERNAL_INTERACTIVE {
        return Err("This command is not configured for the interactive terminal.".to_string());
    }

    let project_path = PathBuf::from(&project.path);
    if !project_path.exists() {
        return Err("Project path does not exist".to_string());
    }

    fs::create_dir_all(&state.paths.scripts_dir).map_err(|error| error.to_string())?;
    let interactive_terminal_kind =
        normalize_interactive_terminal_kind(Some(&command.interactive_terminal_kind));
    let script_path = write_interactive_script(
        &state.paths.scripts_dir,
        &command.script,
        &interactive_terminal_kind,
    )?;
    let started_at = now();
    sql_query(format!(
        "UPDATE commands SET run_count = COALESCE(run_count, 0) + 1, updated_at = '{}' WHERE id = {}",
        started_at, command_id
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    sql_query(format!(
        "INSERT INTO command_runs (command_id, flow_node_id, status, started_at) VALUES ({}, {}, 'running', '{}')",
        command_id, optional_sql(&flow_node_id.map(str::to_string)), started_at
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    let run = sql_query("SELECT * FROM command_runs WHERE id = last_insert_rowid()")
        .get_result::<CommandRun>(&mut conn)
        .map_err(|error| error.to_string())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(cols, rows))
        .map_err(|error| error.to_string())?;
    let mut pty_command =
        build_interactive_pty_command(&script_path, &project_path, &interactive_terminal_kind)?;
    pty_command.cwd(project_path);

    let mut child = match pair.slave.spawn_command(pty_command) {
        Ok(child) => child,
        Err(error) => {
            let ended_at = now();
            let _ = sql_query(format!(
                "UPDATE command_runs SET status = 'failed', ended_at = '{}', exit_code = NULL WHERE id = {}",
                ended_at, run.id
            ))
            .execute(&mut conn);
            let _ = fs::remove_file(&script_path);
            return Err(error.to_string());
        }
    };

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let killer = child.clone_killer();
    let child_pid = child.process_id();
    let session_id = Uuid::new_v4().to_string();
    let session = Arc::new(InteractiveSession {
        run_id: run.id,
        pid: child_pid,
        lifecycle: AtomicU8::new(INTERACTIVE_RUNNING),
        killer: Mutex::new(killer),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
    });

    state
        .interactive_sessions
        .lock()
        .map_err(|_| "Interactive session registry lock poisoned".to_string())?
        .insert(session_id.clone(), session.clone());
    state
        .interactive_sessions_by_command
        .lock()
        .map_err(|_| "Interactive command registry lock poisoned".to_string())?
        .insert(command_id, session_id.clone());
    state
        .interactive_sessions_by_run
        .lock()
        .map_err(|_| "Interactive run registry lock poisoned".to_string())?
        .insert(run.id, session_id.clone());

    let started_payload = InteractiveSessionInfo {
        session_id: session_id.clone(),
        run_id: run.id,
        command_id,
        flow_node_id: run.flow_node_id.clone(),
        cols: cols.max(2),
        rows: rows.max(1),
        started_at: run.started_at.clone(),
    };
    let _ = app.emit("pty://started", started_payload.clone());
    let _ = app.emit(
        "command://started",
        RunStartedPayload {
            run_id: run.id,
            command_id,
            flow_node_id: run.flow_node_id.clone(),
            started_at: run.started_at.clone(),
        },
    );

    spawn_interactive_reader(
        app.clone(),
        reader,
        session_id.clone(),
        run.id,
        command_id,
        run.flow_node_id.clone(),
    );

    let paths = state.paths.clone();
    let session_for_wait = session.clone();
    let app_for_wait = app.clone();
    std::thread::spawn(move || {
        let wait_result = child.wait();
        session_for_wait
            .lifecycle
            .store(INTERACTIVE_EXITED, Ordering::SeqCst);
        let exit_code = wait_result.ok().and_then(interactive_exit_code);
        let was_stopped = app_for_wait
            .try_state::<AppState>()
            .and_then(|state| {
                state
                    .stopped_runs
                    .lock()
                    .ok()
                    .map(|mut stopped_runs| stopped_runs.remove(&run.id))
            })
            .unwrap_or(false);
        let final_status = if was_stopped {
            "stopped"
        } else if exit_code == Some(0) {
            "exited"
        } else {
            "failed"
        };
        let ended_at = now();

        if let Ok(mut conn) = connect(&paths) {
            let _ = sql_query(format!(
                "UPDATE command_runs SET status = '{}', ended_at = '{}', exit_code = {} WHERE id = {}",
                final_status,
                ended_at,
                exit_code.map(|code| code.to_string()).unwrap_or_else(|| "NULL".to_string()),
                run.id
            ))
            .execute(&mut conn);
        }

        if let Some(state) = app_for_wait.try_state::<AppState>() {
            remove_interactive_session(&state, &session_id, run.id, command_id);
        }

        let _ = fs::remove_file(&script_path);
        let _ = app_for_wait.emit(
            "pty://exit",
            InteractiveExitPayload {
                session_id: session_id.clone(),
                run_id: run.id,
                command_id,
                flow_node_id: run.flow_node_id.clone(),
                exit_code,
                ended_at: ended_at.clone(),
                status: final_status.to_string(),
            },
        );
        let _ = app_for_wait.emit(
            "command://finished",
            RunFinishedPayload {
                run_id: run.id,
                command_id,
                flow_node_id: run.flow_node_id.clone(),
                status: final_status.to_string(),
                exit_code,
                ended_at,
            },
        );
    });

    Ok(started_payload)
}

#[tauri::command]
fn start_project_interactive_terminal(
    project_path: String,
    terminal_id: i64,
    terminal_kind: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<AppState>,
) -> Result<InteractiveSessionInfo, String> {
    let project_path = PathBuf::from(project_path);
    if !project_path.exists() {
        return Err("Project path does not exist".to_string());
    }

    fs::create_dir_all(&state.paths.scripts_dir).map_err(|error| error.to_string())?;
    let interactive_terminal_kind = normalize_interactive_terminal_kind(Some(&terminal_kind));
    let shell_script = match interactive_terminal_kind.as_str() {
        INTERACTIVE_TERMINAL_KIND_CMD => "@echo off\r\nchcp 65001>nul\r\ncmd /Q /K\r\n".to_string(),
        INTERACTIVE_TERMINAL_KIND_BASH | INTERACTIVE_TERMINAL_KIND_WSL2 => {
            "exec bash\n".to_string()
        }
        INTERACTIVE_TERMINAL_KIND_POWERSHELL_CORE => "pwsh.exe -NoLogo\n".to_string(),
        _ => "powershell.exe -NoLogo\n".to_string(),
    };
    let script_path = write_interactive_script(
        &state.paths.scripts_dir,
        &shell_script,
        &interactive_terminal_kind,
    )?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(cols, rows))
        .map_err(|error| error.to_string())?;
    let mut pty_command =
        build_interactive_pty_command(&script_path, &project_path, &interactive_terminal_kind)?;
    pty_command.cwd(project_path.clone());

    let mut child = match pair.slave.spawn_command(pty_command) {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&script_path);
            return Err(error.to_string());
        }
    };

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let killer = child.clone_killer();
    let child_pid = child.process_id();
    let session_id = Uuid::new_v4().to_string();
    let run_id = NEXT_AD_HOC_RUN_ID.fetch_sub(1, Ordering::SeqCst);
    let started_at = now();
    let session = Arc::new(InteractiveSession {
        run_id,
        pid: child_pid,
        lifecycle: AtomicU8::new(INTERACTIVE_RUNNING),
        killer: Mutex::new(killer),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
    });

    state
        .interactive_sessions
        .lock()
        .map_err(|_| "Interactive session registry lock poisoned".to_string())?
        .insert(session_id.clone(), session.clone());
    state
        .interactive_sessions_by_command
        .lock()
        .map_err(|_| "Interactive command registry lock poisoned".to_string())?
        .insert(terminal_id, session_id.clone());
    state
        .interactive_sessions_by_run
        .lock()
        .map_err(|_| "Interactive run registry lock poisoned".to_string())?
        .insert(run_id, session_id.clone());

    let started_payload = InteractiveSessionInfo {
        session_id: session_id.clone(),
        run_id,
        command_id: terminal_id,
        flow_node_id: None,
        cols: cols.max(2),
        rows: rows.max(1),
        started_at: started_at.clone(),
    };
    let _ = app.emit("pty://started", started_payload.clone());
    let _ = app.emit(
        "command://started",
        RunStartedPayload {
            run_id,
            command_id: terminal_id,
            flow_node_id: None,
            started_at: started_at.clone(),
        },
    );

    spawn_interactive_reader(
        app.clone(),
        reader,
        session_id.clone(),
        run_id,
        terminal_id,
        None,
    );

    let app_for_wait = app.clone();
    let session_for_wait = session.clone();
    std::thread::spawn(move || {
        let wait_result = child.wait();
        session_for_wait
            .lifecycle
            .store(INTERACTIVE_EXITED, Ordering::SeqCst);
        let exit_code = wait_result.ok().and_then(interactive_exit_code);
        let was_stopped = app_for_wait
            .try_state::<AppState>()
            .and_then(|state| {
                state
                    .stopped_runs
                    .lock()
                    .ok()
                    .map(|mut stopped_runs| stopped_runs.remove(&run_id))
            })
            .unwrap_or(false);
        let final_status = if was_stopped {
            "stopped"
        } else if exit_code == Some(0) {
            "exited"
        } else {
            "failed"
        };
        let ended_at = now();

        if let Some(state) = app_for_wait.try_state::<AppState>() {
            remove_interactive_session(&state, &session_id, run_id, terminal_id);
        }

        let _ = fs::remove_file(&script_path);
        let _ = app_for_wait.emit(
            "pty://exit",
            InteractiveExitPayload {
                session_id: session_id.clone(),
                run_id,
                command_id: terminal_id,
                flow_node_id: None,
                exit_code,
                ended_at: ended_at.clone(),
                status: final_status.to_string(),
            },
        );
        let _ = app_for_wait.emit(
            "command://finished",
            RunFinishedPayload {
                run_id,
                command_id: terminal_id,
                flow_node_id: None,
                status: final_status.to_string(),
                exit_code,
                ended_at,
            },
        );
    });

    Ok(started_payload)
}

#[tauri::command]
fn write_interactive_terminal(
    session_id: String,
    data: String,
    state: State<AppState>,
) -> Result<(), String> {
    debug_pty_io(&session_id, "input", data.as_bytes());
    let session = state
        .interactive_sessions
        .lock()
        .map_err(|_| "Interactive session registry lock poisoned".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Interactive session not found".to_string())?;

    let write_result = session
        .writer
        .lock()
        .map_err(|_| "Interactive writer lock poisoned".to_string())?
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string());
    write_result
}

#[tauri::command]
fn resize_interactive_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppState>,
) -> Result<(), String> {
    let session = state
        .interactive_sessions
        .lock()
        .map_err(|_| "Interactive session registry lock poisoned".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Interactive session not found".to_string())?;

    let resize_result = session
        .master
        .lock()
        .map_err(|_| "Interactive pty lock poisoned".to_string())?
        .resize(pty_size(cols, rows))
        .map_err(|error| error.to_string());
    resize_result
}

#[tauri::command]
fn stop_interactive_command(
    session_id: String,
    state: State<AppState>,
) -> Result<StopCommandResult, String> {
    let session = state
        .interactive_sessions
        .lock()
        .map_err(|_| "Interactive session registry lock poisoned".to_string())?
        .get(&session_id)
        .cloned();
    let Some(session) = session else {
        return Ok(StopCommandResult { was_active: false });
    };

    if session
        .lifecycle
        .compare_exchange(
            INTERACTIVE_RUNNING,
            INTERACTIVE_STOPPING,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_err()
    {
        return Ok(StopCommandResult { was_active: false });
    }

    state
        .stopped_runs
        .lock()
        .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
        .insert(session.run_id);

    let kill_result = kill_interactive_process(&session);
    if let Err(error) = kill_result {
        session
            .lifecycle
            .store(INTERACTIVE_RUNNING, Ordering::SeqCst);
        state
            .stopped_runs
            .lock()
            .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
            .remove(&session.run_id);
        return Err(error);
    }

    Ok(StopCommandResult { was_active: true })
}

#[tauri::command]
async fn restart_interactive_command(
    command_id: i64,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<InteractiveSessionInfo, String> {
    let existing_session_id = state
        .interactive_sessions_by_command
        .lock()
        .map_err(|_| "Interactive command registry lock poisoned".to_string())?
        .get(&command_id)
        .cloned();

    if let Some(session_id) = existing_session_id {
        stop_interactive_command(session_id.clone(), state.clone())?;
        for _ in 0..100 {
            let still_running = state
                .interactive_sessions_by_command
                .lock()
                .map_err(|_| "Interactive command registry lock poisoned".to_string())?
                .contains_key(&command_id);
            if !still_running {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let still_running = state
            .interactive_sessions_by_command
            .lock()
            .map_err(|_| "Interactive command registry lock poisoned".to_string())?
            .contains_key(&command_id);
        if still_running {
            return Err("Timed out while stopping the previous interactive session".to_string());
        }
    }

    start_interactive_command(command_id, cols, rows, app, state)
}

#[cfg(target_os = "windows")]
fn kill_interactive_process(session: &InteractiveSession) -> Result<(), String> {
    if let Some(pid) = session.pid {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        configure_command(&mut command);
        let status = command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            return Ok(());
        }
    }

    session
        .killer
        .lock()
        .map_err(|_| "Interactive killer lock poisoned".to_string())?
        .kill()
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn kill_interactive_process(session: &InteractiveSession) -> Result<(), String> {
    session
        .killer
        .lock()
        .map_err(|_| "Interactive killer lock poisoned".to_string())?
        .kill()
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PortProcess {
    port: u16,
    pid: u32,
    name: String,
}

#[tauri::command]
async fn get_ports_processes(ports: Vec<u16>) -> Result<Vec<PortProcess>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target_ports = ports.into_iter().collect::<HashSet<u16>>();
        if target_ports.is_empty() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        #[cfg(target_os = "windows")]
        {
            // 1. Get process names using tasklist
            let mut process_names = HashMap::new();
            let mut cmd1 = Command::new("tasklist");
            cmd1.args(["/FO", "CSV", "/NH"]);
            configure_command(&mut cmd1);
            if let Ok(output) = cmd1.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split("\",\"").collect();
                    if parts.len() >= 2 {
                        let name = parts[0].trim_start_matches('"').to_string();
                        let pid_str = parts[1].trim_end_matches('"');
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            process_names.insert(pid, name);
                        }
                    }
                }
            }

            // 2. Scan netstat to map ports to PIDs
            let mut cmd2 = Command::new("netstat");
            cmd2.arg("-ano");
            configure_command(&mut cmd2);
            if let Ok(output) = cmd2.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut seen = HashSet::new();
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 5 {
                        let local_addr = parts[1];
                        let state = parts[3];
                        let pid_str = parts[4];
                        if state.eq_ignore_ascii_case("LISTENING") {
                            if let Some(pos) = local_addr.rfind(':') {
                                if let Ok(p) = local_addr[pos + 1..].parse::<u16>() {
                                    if target_ports.contains(&p) {
                                        if let Ok(pid) = pid_str.parse::<u32>() {
                                            if seen.insert((p, pid)) {
                                                let name = process_names
                                                    .get(&pid)
                                                    .cloned()
                                                    .unwrap_or_else(|| "Unknown".to_string());
                                                results.push(PortProcess { port: p, pid, name });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if executable_exists("lsof") {
                let ports_str = target_ports
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<String>>()
                    .join(",");
                let filter = format!("-iTCP:{}", ports_str);
                if let Ok(output) = Command::new("lsof")
                    .args([&filter, "-sTCP:LISTEN", "-Fpcn"])
                    .output()
                {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let mut current_pid: Option<u32> = None;
                    let mut current_name: Option<String> = None;
                    for line in stdout.lines() {
                        if line.starts_with('p') {
                            current_pid = line[1..].parse::<u32>().ok();
                            current_name = None;
                        } else if line.starts_with('c') {
                            current_name = Some(line[1..].to_string());
                        } else if line.starts_with('n') {
                            let addr = &line[1..];
                            if let Some(pos) = addr.rfind(':') {
                                if let Ok(p) = addr[pos + 1..].parse::<u16>() {
                                    if target_ports.contains(&p) {
                                        if let Some(pid) = current_pid {
                                            let name = current_name
                                                .clone()
                                                .unwrap_or_else(|| "Unknown".to_string());
                                            results.push(PortProcess { port: p, pid, name });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            #[cfg(target_os = "linux")]
            if results.is_empty() {
                results = port_processes_from_ss(&target_ports)?;
            }
        }

        Ok(results)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn kill_processes(pids: Vec<u32>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for pid in pids {
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("taskkill");
                cmd.args(["/PID", &pid.to_string(), "/F", "/T"]);
                configure_command(&mut cmd);
                let _ = cmd.status();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn kill_ports(ports: Vec<u16>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ports = ports.into_iter().collect::<HashSet<_>>();
        if ports.is_empty() {
            return Ok(());
        }
        for port in ports {
            kill_port(port)?;
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(target_os = "windows")]
fn kill_port(port: u16) -> Result<(), String> {
    let mut cmd = Command::new("netstat");
    cmd.arg("-ano");
    configure_command(&mut cmd);
    let output = cmd.output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut pids = HashSet::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let local_addr = parts[1];
            let state = parts[3];
            let pid_str = parts[4];
            if state.eq_ignore_ascii_case("LISTENING") {
                if let Some(pos) = local_addr.rfind(':') {
                    if let Ok(p) = local_addr[pos + 1..].parse::<u16>() {
                        if p == port {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                pids.insert(pid);
                            }
                        }
                    }
                }
            }
        }
    }
    for pid in pids {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/F", "/T"]);
        configure_command(&mut cmd);
        let _ = cmd.status();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn kill_port(port: u16) -> Result<(), String> {
    let mut supported_tool_found = executable_exists("lsof");
    let mut pids = pids_from_lsof(port)?;
    #[cfg(target_os = "linux")]
    {
        supported_tool_found =
            supported_tool_found || executable_exists("ss") || executable_exists("fuser");
        if pids.is_empty() {
            pids = pids_from_ss(port)?;
        }
    }
    if !pids.is_empty() {
        kill_pid_list(pids);
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    if try_kill_with_fuser(port)? {
        return Ok(());
    }

    if supported_tool_found {
        Ok(())
    } else {
        Err("No supported non-Windows port management utility was found. Install lsof, ss, or fuser.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn kill_process_tree(process: &RunProcess) -> Result<(), String> {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &process.pid.to_string(), "/T", "/F"]);
    configure_command(&mut cmd);
    let status = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to stop process tree for PID {}",
            process.pid
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(process: &RunProcess) -> Result<(), String> {
    process
        .child
        .lock()
        .map_err(|_| "Process lock poisoned".to_string())?
        .kill()
        .map_err(|error| error.to_string())
}

fn stop_run_process(process: Arc<RunProcess>) -> Result<(), String> {
    match kill_process_tree(&process) {
        Ok(()) => Ok(()),
        Err(error) => {
            if process_has_exited(&process)? {
                Ok(())
            } else {
                Err(error)
            }
        }
    }
}

fn process_has_exited(process: &RunProcess) -> Result<bool, String> {
    process
        .child
        .lock()
        .map_err(|_| "Process lock poisoned".to_string())?
        .try_wait()
        .map(|status| status.is_some())
        .map_err(|error| error.to_string())
}

fn mark_stale_running_runs(conn: &mut SqliteConnection, state: &AppState) -> Result<(), String> {
    let active_run_ids = state
        .processes
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?
        .keys()
        .copied()
        .collect::<HashSet<_>>();
    let running_runs = sql_query("SELECT * FROM command_runs WHERE status = 'running'")
        .load::<CommandRun>(conn)
        .map_err(|error| error.to_string())?;
    let ended_at = now();

    for run in running_runs {
        if !active_run_ids.contains(&run.id) {
            sql_query(format!(
                "UPDATE command_runs SET status = 'failed', ended_at = '{}', exit_code = NULL WHERE id = {}",
                ended_at, run.id
            ))
            .execute(conn)
            .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn mark_all_running_runs_failed(paths: &AppPaths) -> Result<(), String> {
    let mut conn = connect(paths)?;
    sql_query(format!(
        "UPDATE command_runs SET status = 'failed', ended_at = '{}', exit_code = NULL WHERE status = 'running'",
        now()
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn write_script(scripts_dir: &Path, script: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let extension = "ps1";
    #[cfg(not(target_os = "windows"))]
    let extension = "sh";

    let script_path = scripts_dir.join(format!("run-{}.{}", Uuid::new_v4(), extension));
    let content = if cfg!(target_os = "windows") {
        format!(
            "$ErrorActionPreference = 'Stop'\r\n[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()\r\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\r\n$OutputEncoding = [System.Text.UTF8Encoding]::new()\r\n{}\r\n",
            script
        )
    } else {
        format!("#!/usr/bin/env sh\nset -e\n{}\n", script)
    };
    fs::write(&script_path, content).map_err(|error| error.to_string())?;
    Ok(script_path)
}

fn build_pty_command(script_path: &Path) -> PtyCommandBuilder {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = PtyCommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd.arg("-NoProfile");
        cmd.arg("-ExecutionPolicy");
        cmd.arg("Bypass");
        cmd.arg("-File");
        cmd.arg(script_path);
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = PtyCommandBuilder::new("sh");
        cmd.arg(script_path);
        cmd
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn interactive_exit_code(status: portable_pty::ExitStatus) -> Option<i32> {
    Some(status.exit_code() as i32)
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.decode(bytes, false)
    }

    fn finish(&mut self) -> String {
        self.decode(&[], true)
    }

    fn decode(&mut self, bytes: &[u8], end_of_stream: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        let mut cursor = 0;

        while cursor < self.pending.len() {
            match std::str::from_utf8(&self.pending[cursor..]) {
                Ok(valid) => {
                    output.push_str(valid);
                    cursor = self.pending.len();
                }
                Err(error) => {
                    let valid_end = cursor + error.valid_up_to();
                    if valid_end > cursor {
                        output.push_str(
                            std::str::from_utf8(&self.pending[cursor..valid_end])
                                .expect("UTF-8 valid prefix"),
                        );
                        cursor = valid_end;
                    }

                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        cursor += error_len;
                    } else if end_of_stream {
                        output.push('\u{FFFD}');
                        cursor = self.pending.len();
                    } else {
                        break;
                    }
                }
            }
        }

        if cursor > 0 {
            self.pending.drain(..cursor);
        }
        output
    }
}

fn spawn_interactive_reader(
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut decoder = Utf8StreamDecoder::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    debug_pty_io(&session_id, "output", &buffer[..length]);
                    let chunk = decoder.push(&buffer[..length]);
                    if !chunk.is_empty() {
                        let _ = app.emit(
                            "pty://data",
                            InteractiveDataPayload {
                                session_id: session_id.clone(),
                                run_id,
                                command_id,
                                flow_node_id: flow_node_id.clone(),
                                data: chunk,
                            },
                        );
                    }
                }
                Err(error) => {
                    if is_benign_interactive_read_error(&error) {
                        break;
                    }

                    let _ = app.emit(
                        "pty://error",
                        InteractiveErrorPayload {
                            session_id: session_id.clone(),
                            run_id,
                            command_id,
                            flow_node_id: flow_node_id.clone(),
                            error: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }

        let final_chunk = decoder.finish();
        if !final_chunk.is_empty() {
            let _ = app.emit(
                "pty://data",
                InteractiveDataPayload {
                    session_id,
                    run_id,
                    command_id,
                    flow_node_id,
                    data: final_chunk,
                },
            );
        }
    });
}

fn debug_pty_io(session_id: &str, direction: &str, bytes: &[u8]) {
    if !cfg!(debug_assertions)
        || std::env::var_os("PROJECTS_RUNNER_DEBUG_PTY") != Some(OsString::from("1"))
    {
        return;
    }

    let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
    eprintln!(
        "[pty:{session_id}] {direction} {} bytes: {}{}",
        bytes.len(),
        preview.escape_debug(),
        if bytes.len() > 512 { "…" } else { "" },
    );
}

fn is_benign_interactive_read_error(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::BrokenPipe {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        if error.raw_os_error() == Some(0) {
            return true;
        }
    }

    false
}

fn remove_interactive_session(state: &AppState, session_id: &str, run_id: i64, command_id: i64) {
    if let Ok(mut sessions) = state.interactive_sessions.lock() {
        sessions.remove(session_id);
    }
    if let Ok(mut sessions_by_command) = state.interactive_sessions_by_command.lock() {
        let should_remove = sessions_by_command
            .get(&command_id)
            .map(|existing| existing == session_id)
            .unwrap_or(false);
        if should_remove {
            sessions_by_command.remove(&command_id);
        }
    }
    if let Ok(mut sessions_by_run) = state.interactive_sessions_by_run.lock() {
        let should_remove = sessions_by_run
            .get(&run_id)
            .map(|existing| existing == session_id)
            .unwrap_or(false);
        if should_remove {
            sessions_by_run.remove(&run_id);
        }
    }
}

fn build_process(
    script_path: &Path,
    project_path: &Path,
    run_in_external_terminal: bool,
    external_terminal_kind: &str,
) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        if run_in_external_terminal {
            let cmd = match external_terminal_kind {
                EXTERNAL_TERMINAL_KIND_WINDOWS_TERMINAL => {
                    let mut wt = Command::new("wt.exe");
                    wt.arg("powershell.exe")
                        .arg("-NoExit")
                        .arg("-File")
                        .arg(script_path);
                    wt
                }
                EXTERNAL_TERMINAL_KIND_COMMAND_PROMPT => {
                    let mut prompt = Command::new("cmd.exe");
                    prompt
                        .arg("/c")
                        .arg("start")
                        .arg("/wait")
                        .arg("cmd.exe")
                        .arg("/k")
                        .arg(format!(
                            "powershell.exe -NoExit -ExecutionPolicy Bypass -File \"{}\"",
                            script_path.to_string_lossy()
                        ));
                    prompt
                }
                EXTERNAL_TERMINAL_KIND_POWERSHELL | EXTERNAL_TERMINAL_KIND_DEFAULT => {
                    let mut shell = Command::new("cmd.exe");
                    shell
                        .arg("/c")
                        .arg("start")
                        .arg("/wait")
                        .arg("powershell.exe")
                        .arg("-NoExit")
                        .arg("-ExecutionPolicy")
                        .arg("Bypass")
                        .arg("-File")
                        .arg(script_path);
                    shell
                }
                _ => {
                    let mut shell = Command::new("cmd.exe");
                    shell
                        .arg("/c")
                        .arg("start")
                        .arg("/wait")
                        .arg("powershell.exe")
                        .arg("-NoExit")
                        .arg("-ExecutionPolicy")
                        .arg("Bypass")
                        .arg("-File")
                        .arg(script_path);
                    shell
                }
            };
            cmd
        } else {
            let mut cmd = Command::new("powershell.exe");
            cmd.arg("-NoLogo")
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(script_path);
            configure_command(&mut cmd);
            cmd
        }
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        if run_in_external_terminal {
            let app_name = match external_terminal_kind {
                EXTERNAL_TERMINAL_KIND_TERMINAL_APP | EXTERNAL_TERMINAL_KIND_DEFAULT => "Terminal",
                _ => "Terminal",
            };
            let mut cmd = Command::new("osascript");
            let script = format!(
                "tell application \"{}\" to do script \"cd '{}' && '{}'; exit\"",
                app_name,
                project_path.to_string_lossy(),
                script_path.to_string_lossy()
            );
            cmd.arg("-e").arg(script);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg(script_path);
            cmd
        }
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = if run_in_external_terminal {
        build_linux_script_terminal_command(script_path, project_path)?
    } else {
        let mut cmd = Command::new("sh");
        cmd.arg(script_path);
        cmd
    };

    command.current_dir(project_path);

    if run_in_external_terminal {
        command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())
    } else {
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())
    }
}

fn spawn_output_reader<R>(
    app: AppHandle,
    run_id: i64,
    command_id: i64,
    flow_node_id: Option<String>,
    reader: R,
    event: &'static str,
) where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app.emit(
                event,
                RunOutputPayload {
                    run_id,
                    command_id,
                    flow_node_id: flow_node_id.clone(),
                    line,
                },
            );
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fix_path_env::fix();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let cwd = PathBuf::from(cwd);
            for file_path in
                collect_prd_paths_from_args(args.into_iter().map(OsString::from), Some(&cwd))
            {
                emit_prd_open_request(app, file_path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let paths = app_paths(app.handle())?;
            init_db(&paths).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            mark_all_running_runs_failed(&paths)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(AppState {
                paths,
                processes: Mutex::new(HashMap::new()),
                interactive_sessions: Mutex::new(HashMap::new()),
                interactive_sessions_by_command: Mutex::new(HashMap::new()),
                interactive_sessions_by_run: Mutex::new(HashMap::new()),
                stopped_runs: Mutex::new(HashSet::new()),
                pending_prd_open_requests: Mutex::new(Vec::new()),
            });
            app.manage(app_updates::UpdateState::default());
            let current_dir = std::env::current_dir().ok();
            for file_path in
                collect_prd_paths_from_args(std::env::args_os().skip(1), current_dir.as_deref())
            {
                store_pending_prd_open_request(app.handle(), file_path);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            update_project,
            delete_project,
            list_project_files,
            list_project_files_page,
            get_project_file_info,
            get_project_folder_size,
            project_file_exists,
            list_dev_project_types,
            scan_dev_project_types,
            get_folder_dev_project_types,
            set_folder_dev_project_types,
            scan_dev_cache,
            clean_dev_cache,
            create_project_file,
            create_project_folder,
            paste_project_file,
            rename_project_file,
            delete_project_file,
            reveal_project_file,
            open_project_file,
            read_project_file,
            list_commands,
            list_command_sections,
            create_command_section,
            rename_command_section,
            delete_command_section,
            list_flows,
            get_flow,
            create_flow,
            update_flow,
            save_flow_graph,
            delete_flow,
            start_flow_node,
            create_command,
            update_command,
            delete_command,
            run_command,
            restart_command,
            stop_command,
            start_interactive_command,
            start_project_interactive_terminal,
            list_interactive_terminal_options,
            write_interactive_terminal,
            resize_interactive_terminal,
            stop_interactive_command,
            restart_interactive_command,
            kill_ports,
            get_ports_processes,
            kill_processes,
            app_info,
            export_project,
            pick_prd_file,
            analyze_prd_file,
            import_prd_file,
            apply_prd_import,
            pick_project_folder,
            show_project_in_explorer,
            open_in_external_terminal,
            pick_and_copy_avatar,
            take_pending_prd_open_requests,
            app_updates::check_for_update,
            app_updates::download_update,
            app_updates::reveal_downloaded_update,
            app_updates::install_downloaded_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
