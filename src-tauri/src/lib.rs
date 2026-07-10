use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Integer, Nullable, Text};
use diesel::sqlite::SqliteConnection;
use mime_guess::MimeGuess;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Clone)]
struct AppPaths {
    db_path: PathBuf,
    avatars_dir: PathBuf,
    scripts_dir: PathBuf,
}

struct AppState {
    paths: AppPaths,
    processes: Mutex<HashMap<i64, Arc<RunProcess>>>,
    stopped_runs: Mutex<HashSet<i64>>,
    pending_prd_open_requests: Mutex<Vec<String>>,
}

struct RunProcess {
    pid: u32,
    child: Mutex<Child>,
}

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
    #[diesel(sql_type = Integer)]
    run_in_external_terminal: i32,
}

#[derive(Debug, Serialize, QueryableByName)]
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
}

#[derive(Debug, Serialize, Clone)]
struct RunStartedPayload {
    run_id: i64,
    command_id: i64,
    started_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct RunOutputPayload {
    run_id: i64,
    command_id: i64,
    line: String,
}

#[derive(Debug, Serialize, Clone)]
struct RunFinishedPayload {
    run_id: i64,
    command_id: i64,
    status: String,
    exit_code: Option<i32>,
    ended_at: String,
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
    run_in_external_terminal: Option<bool>,
}

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
    run_in_external_terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrdFileV2 {
    format: String,
    exported_at: String,
    project: PrdProjectV2,
    commands: Vec<PrdCommandV2>,
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
    run_in_external_terminal: bool,
}

#[derive(Debug, Clone)]
struct NormalizedPrdFile {
    format: String,
    exported_at: String,
    project: NormalizedPrdProject,
    commands: Vec<NormalizedPrdCommand>,
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

    sql_query(
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
    .execute(&mut conn)
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
            run_in_external_terminal INTEGER NOT NULL DEFAULT 0,
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
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            exit_code INTEGER,
            FOREIGN KEY(command_id) REFERENCES commands(id) ON DELETE CASCADE
        );",
    )
    .execute(&mut conn)
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
        "run_in_external_terminal",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    Ok(())
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

    let columns = sql_query(format!("PRAGMA table_info({})", table))
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
    let mut sections = prd
        .commands
        .iter()
        .map(|command| command.section.clone())
        .collect::<Vec<_>>();
    sections.sort();
    sections.dedup();
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

fn build_export_prd(project: &Project, commands: &[ProjectCommand]) -> Result<PrdFileV2, String> {
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
                    run_in_external_terminal: command.run_in_external_terminal != 0,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
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
                run_in_external_terminal: Some(command.run_in_external_terminal),
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
    let default_name = format!("{}.prd", sanitize_file_name(&project.name));
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Project Runner Data", &["prd"])
        .set_file_name(&default_name)
        .save_file()
    else {
        return Ok(None);
    };

    let prd = build_export_prd(&project, &commands)?;
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
                                run_in_external_terminal: Some(incoming.run_in_external_terminal),
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
                                    run_in_external_terminal: Some(incoming.run_in_external_terminal),
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
                run_in_external_terminal: command.run_in_external_terminal.unwrap_or(false),
            })
            .collect(),
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
                run_in_external_terminal: command.run_in_external_terminal,
            })
            .collect(),
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

    sql_query("SELECT * FROM projects WHERE id = last_insert_rowid()")
        .get_result::<Project>(&mut conn)
        .map_err(|error| error.to_string())
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

#[tauri::command]
fn create_command(input: CommandInput, state: State<AppState>) -> Result<ProjectCommand, String> {
    let mut conn = connect(&state.paths)?;
    let timestamp = now();
    let order_index = input.order_index.unwrap_or(0);
    let ports = ports_to_json(&input.ports.unwrap_or_default())?;
    let section = clean_section(input.section);
    let run_in_external_terminal = if input.run_in_external_terminal.unwrap_or(false) {
        1
    } else {
        0
    };
    sql_query(format!(
        "INSERT INTO commands (project_id, name, script, avatar_path, ports, section, order_index, run_in_external_terminal, created_at, updated_at)
         VALUES ({}, '{}', '{}', {}, '{}', '{}', {}, {}, '{}', '{}')",
        input.project_id,
        quote_sql(&input.name),
        quote_sql(&input.script),
        optional_sql(&input.avatar_path),
        quote_sql(&ports),
        quote_sql(&section),
        order_index,
        run_in_external_terminal,
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
    let section = clean_section(input.section);
    let run_in_external_terminal = if input.run_in_external_terminal.unwrap_or(false) {
        1
    } else {
        0
    };
    sql_query(format!(
        "UPDATE commands SET project_id = {}, name = '{}', script = '{}', avatar_path = {}, ports = '{}', section = '{}', order_index = {}, run_in_external_terminal = {}, updated_at = '{}' WHERE id = {}",
        input.project_id,
        quote_sql(&input.name),
        quote_sql(&input.script),
        optional_sql(&input.avatar_path),
        quote_sql(&ports),
        quote_sql(&section),
        order_index,
        run_in_external_terminal,
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
        let mut command = {
            let mut cmd = Command::new("x-terminal-emulator");
            cmd
        };

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
    let mut conn = connect(&state.paths)?;
    mark_stale_running_runs(&mut conn, &state)?;
    let active_runs = sql_query(format!(
        "SELECT * FROM command_runs WHERE command_id = {} AND status = 'running'",
        command_id
    ))
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

    fs::create_dir_all(&state.paths.scripts_dir).map_err(|error| error.to_string())?;
    let script_path = write_script(&state.paths.scripts_dir, &command.script)?;
    let started_at = now();
    sql_query(format!(
        "INSERT INTO command_runs (command_id, status, started_at) VALUES ({}, 'running', '{}')",
        command_id, started_at
    ))
    .execute(&mut conn)
    .map_err(|error| error.to_string())?;
    let run = sql_query("SELECT * FROM command_runs WHERE id = last_insert_rowid()")
        .get_result::<CommandRun>(&mut conn)
        .map_err(|error| error.to_string())?;
    let run_in_external_terminal = command.run_in_external_terminal != 0;
    let mut child = match build_process(&script_path, &project_path, run_in_external_terminal) {
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
            started_at: run.started_at.clone(),
        },
    );

    if let Some(stdout) = stdout {
        spawn_output_reader(app.clone(), run.id, command_id, stdout, "command://stdout");
    }
    if let Some(stderr) = stderr {
        spawn_output_reader(app.clone(), run.id, command_id, stderr, "command://stderr");
    }

    let paths = state.paths.clone();
    let app_for_wait = app.clone();
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
                status: final_status.to_string(),
                exit_code,
                ended_at,
            },
        );
    });

    Ok(run)
}

#[cfg(target_os = "windows")]
fn configure_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}
#[cfg(not(target_os = "windows"))]
fn configure_command(_cmd: &mut Command) {}

#[tauri::command]
async fn stop_command(run_id: i64, state: State<'_, AppState>) -> Result<StopCommandResult, String> {
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
        sql_query(format!(
            "UPDATE command_runs SET status = 'stopped', ended_at = '{}' WHERE id = {} AND status = 'running'",
            ended_at, run_id
        ))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;
        return Ok(StopCommandResult { was_active: false });
    };

    state
        .stopped_runs
        .lock()
        .map_err(|_| "Stopped-run registry lock poisoned".to_string())?
        .insert(run_id);
    tauri::async_runtime::spawn_blocking(move || kill_process_tree(&process))
        .await
        .map_err(|err| err.to_string())??;
    Ok(StopCommandResult { was_active: true })
}

#[derive(serde::Serialize)]
struct StopCommandResult {
    was_active: bool,
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
    let status = Command::new("sh")
        .arg("-c")
        .arg(format!("lsof -ti tcp:{} | xargs -r kill -9", port))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to kill processes on port {}", port))
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

fn mark_stale_running_runs(
    conn: &mut SqliteConnection,
    state: &State<AppState>,
) -> Result<(), String> {
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

fn build_process(
    script_path: &Path,
    project_path: &Path,
    run_in_external_terminal: bool,
) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        if run_in_external_terminal {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/c")
                .arg("start")
                .arg("/wait")
                .arg("powershell.exe")
                .arg("-NoExit")
                .arg("-File")
                .arg(script_path);
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
            let mut cmd = Command::new("osascript");
            let script = format!(
                "tell application \"Terminal\" to do script \"cd '{}' && '{}'; exit\"",
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
    let mut command = {
        if run_in_external_terminal {
            let mut cmd = Command::new("x-terminal-emulator");
            cmd.arg("-e").arg("sh").arg(script_path);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg(script_path);
            cmd
        }
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
                    line,
                },
            );
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .setup(|app| {
            let paths = app_paths(app.handle())?;
            init_db(&paths).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            mark_all_running_runs_failed(&paths)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(AppState {
                paths,
                processes: Mutex::new(HashMap::new()),
                stopped_runs: Mutex::new(HashSet::new()),
                pending_prd_open_requests: Mutex::new(Vec::new()),
            });
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
            list_commands,
            create_command,
            update_command,
            delete_command,
            run_command,
            stop_command,
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
            take_pending_prd_open_requests
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
