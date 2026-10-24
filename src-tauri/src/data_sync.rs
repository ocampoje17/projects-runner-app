//! Portable, manually triggered, three-way synchronization. The working database
//! never lives on removable media. Published revisions are immutable.
use crate::{connect, AppPaths, AppState};
use diesel::{connection::SimpleConnection, prelude::*, sql_query, sql_types::Text};
use fs4::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use ts_rs::TS;
use uuid::Uuid;

const FORMAT: u32 = 1;
const DIRECTORY: &str = ".projects-runner-sync";
pub const PREFERENCE_KEYS: &[&str] = &[
    "theme",
    "accent",
    "dateFormat",
    "terminalFontSize",
    "terminalFontFamily",
    "autoClearLogs",
    "showLogsTimestamp",
    "showStreamName",
    "explorerAllowMultipleOpen",
    "restoreOpenTabs",
];
type Preferences = BTreeMap<String, String>;
type Choices = BTreeMap<String, String>;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct SyncScopes {
    pub projects: bool,
    pub commands: bool,
    pub notes: bool,
    pub avatars: bool,
    pub preferences: bool,
}
impl Default for SyncScopes {
    fn default() -> Self {
        Self {
            projects: true,
            commands: true,
            notes: true,
            avatars: true,
            preferences: true,
        }
    }
}
impl SyncScopes {
    fn includes(&self, kind: &str) -> bool {
        match kind {
            "project" => self.projects,
            "command" | "section" => self.commands,
            "note" => self.notes,
            "avatar" => self.avatars,
            "preference" => self.preferences,
            _ => false,
        }
    }
    fn validate(&self) -> Result<(), String> {
        if !self.projects && (self.commands || self.notes || self.avatars) {
            return Err("Projects must be enabled for commands, notes, or avatars.".into());
        }
        if !(self.projects || self.preferences) {
            return Err("Select at least one data group to sync.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncStatus {
    pub folder: Option<String>,
    pub repository_id: Option<String>,
    pub scopes: SyncScopes,
    pub last_synced_at: Option<String>,
    pub pending_preferences: Preferences,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncLink {
    pub local_id: String,
    pub remote_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncLinkCandidate {
    pub local_id: String,
    pub remote_id: String,
    pub local_label: String,
    pub remote_label: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncConflict {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub local: Option<String>,
    pub remote: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncPreview {
    pub session_id: String,
    pub links: Vec<SyncLinkCandidate>,
    pub conflicts: Vec<SyncConflict>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SyncResult {
    pub status: SyncStatus,
    pub preferences: Preferences,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Config {
    device_id: String,
    active: Option<String>,
    profiles: BTreeMap<String, Profile>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Profile {
    folder: String,
    repository_id: Option<String>,
    scopes: SyncScopes,
    last_synced_at: Option<String>,
    #[serde(default)]
    last_revision_id: Option<String>,
    baseline: Snapshot,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
struct Snapshot {
    records: BTreeMap<String, Record>,
    tombstones: BTreeMap<String, Record>,
    paths: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Record {
    kind: String,
    project: Option<String>,
    data: Value,
}
impl Record {
    fn label(&self) -> String {
        self.data
            .get("name")
            .or_else(|| self.data.get("title"))
            .or_else(|| self.data.get("key"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(&self.kind)
            .to_string()
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Manifest {
    format: u32,
    repository_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Revision {
    format: u32,
    repository_id: String,
    id: String,
    parent: Option<String>,
    generation: u64,
    device_id: String,
    created_at: String,
    snapshot: Snapshot,
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    checksum: String,
    revision: Revision,
}
#[derive(Clone, Serialize, Deserialize)]
struct Journal {
    profile_key: String,
    revision: Revision,
    links: Vec<SyncLink>,
}
struct Session {
    id: String,
    profile_key: String,
    profile: Profile,
    head: Option<Revision>,
    local: Snapshot,
    linked_local: Snapshot,
    links: Vec<SyncLink>,
    assets: BTreeMap<String, Vec<u8>>,
}
#[derive(Default)]
pub struct SyncService {
    session: Mutex<Option<Session>>,
    operation: Mutex<()>,
    #[cfg(test)]
    fail_after_publish: std::sync::atomic::AtomicBool,
}

#[derive(QueryableByName)]
struct JsonRow {
    #[diesel(sql_type = Text)]
    value: String,
}
fn rows(conn: &mut SqliteConnection, sql: &str) -> Result<Vec<Value>, String> {
    sql_query(sql)
        .load::<JsonRow>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| serde_json::from_str(&r.value).map_err(|e| e.to_string()))
        .collect()
}
fn kv_get<T: for<'a> Deserialize<'a>>(
    conn: &mut SqliteConnection,
    key: &str,
) -> Result<Option<T>, String> {
    let row = sql_query("SELECT value FROM sync_state WHERE key = ?")
        .bind::<Text, _>(key)
        .get_result::<JsonRow>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|r| {
        serde_json::from_str(&r.value).map_err(|e| format!("Invalid local sync state: {e}"))
    })
    .transpose()
}
fn kv_set(conn: &mut SqliteConnection, key: &str, value: &impl Serialize) -> Result<(), String> {
    sql_query("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind::<Text,_>(key).bind::<Text,_>(serde_json::to_string(value).map_err(|e| e.to_string())?)
        .execute(conn).map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn init_schema(conn: &mut SqliteConnection) -> Result<(), String> {
    conn.batch_execute("CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_identity(repository TEXT NOT NULL, kind TEXT NOT NULL, local_key TEXT NOT NULL, uuid TEXT NOT NULL,
        PRIMARY KEY(repository,kind,local_key), UNIQUE(repository,kind,uuid));").map_err(|e| e.to_string())
}
fn config(conn: &mut SqliteConnection) -> Result<Config, String> {
    let mut c = kv_get::<Config>(conn, "config")?.unwrap_or_default();
    if c.device_id.is_empty() {
        c.device_id = Uuid::new_v4().to_string();
        kv_set(conn, "config", &c)?;
    }
    Ok(c)
}
fn active(c: &Config) -> Result<(String, Profile), String> {
    let key = c
        .active
        .as_ref()
        .ok_or("Choose a sync folder in Settings → Data Sync.")?;
    Ok((
        key.clone(),
        c.profiles
            .get(key)
            .ok_or("Sync folder configuration is missing.")?
            .clone(),
    ))
}
fn status(conn: &mut SqliteConnection) -> Result<SyncStatus, String> {
    let c = config(conn)?;
    let profile = c.active.as_ref().and_then(|k| c.profiles.get(k));
    Ok(SyncStatus {
        folder: profile.map(|p| p.folder.clone()),
        repository_id: profile.and_then(|p| p.repository_id.clone()),
        scopes: profile.map(|p| p.scopes.clone()).unwrap_or_default(),
        last_synced_at: profile.and_then(|p| p.last_synced_at.clone()),
        pending_preferences: kv_get(conn, "preferences")?.unwrap_or_default(),
    })
}
fn identity(
    conn: &mut SqliteConnection,
    repo: &str,
    kind: &str,
    key: &str,
) -> Result<String, String> {
    let found = sql_query(
        "SELECT uuid AS value FROM sync_identity WHERE repository=? AND kind=? AND local_key=?",
    )
    .bind::<Text, _>(repo)
    .bind::<Text, _>(kind)
    .bind::<Text, _>(key)
    .get_result::<JsonRow>(conn)
    .optional()
    .map_err(|e| e.to_string())?;
    if let Some(found) = found {
        return Ok(found.value);
    }
    let id = Uuid::new_v4().to_string();
    bind_identity(conn, repo, kind, key, &id)?;
    Ok(id)
}
fn bind_identity(
    conn: &mut SqliteConnection,
    repo: &str,
    kind: &str,
    key: &str,
    uuid: &str,
) -> Result<(), String> {
    sql_query(
        "DELETE FROM sync_identity WHERE repository=? AND kind=? AND uuid=? AND local_key<>?",
    )
    .bind::<Text, _>(repo)
    .bind::<Text, _>(kind)
    .bind::<Text, _>(uuid)
    .bind::<Text, _>(key)
    .execute(conn)
    .map_err(|e| e.to_string())?;
    sql_query("INSERT INTO sync_identity(repository,kind,local_key,uuid) VALUES(?,?,?,?) ON CONFLICT(repository,kind,local_key) DO UPDATE SET uuid=excluded.uuid")
        .bind::<Text,_>(repo).bind::<Text,_>(kind).bind::<Text,_>(key).bind::<Text,_>(uuid).execute(conn).map_err(|e|e.to_string())?;
    Ok(())
}
fn local_key(
    conn: &mut SqliteConnection,
    repo: &str,
    kind: &str,
    uuid: &str,
) -> Result<Option<String>, String> {
    Ok(sql_query(
        "SELECT local_key AS value FROM sync_identity WHERE repository=? AND kind=? AND uuid=?",
    )
    .bind::<Text, _>(repo)
    .bind::<Text, _>(kind)
    .bind::<Text, _>(uuid)
    .get_result::<JsonRow>(conn)
    .optional()
    .map_err(|e| e.to_string())?
    .map(|r| r.value))
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn fingerprint(value: &impl Serialize) -> Result<String, String> {
    Ok(hash(&serde_json::to_vec(value).map_err(|e| e.to_string())?))
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn io_error(e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => format!("The sync folder is read-only or access was denied: {e}"),
        std::io::ErrorKind::StorageFull => "The sync drive is full. Free up space and try again.".into(),
        std::io::ErrorKind::NotFound => "The sync drive or folder is disconnected or missing. Reconnect it, or select its new location in Data Sync settings.".into(),
        _ => format!("Unable to access the sync drive: {e}"),
    }
}
fn read_json<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(path).map_err(io_error)?)
        .map_err(|e| format!("The sync repository contains invalid data: {e}"))
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(io_error)?;
        f.write_all(bytes).map_err(io_error)?;
        f.sync_all().map_err(io_error)?;
        drop(f);
        if hash(&fs::read(&temp).map_err(io_error)?) != hash(bytes) {
            return Err("The sync drive failed to verify a write.".into());
        }
        fs::rename(&temp, path).map_err(io_error)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
struct Repository {
    root: PathBuf,
    manifest: Manifest,
    expected_revision: Option<String>,
    _lock: File,
}
impl Repository {
    fn open(profile: &Profile, create: bool) -> Result<Self, String> {
        let folder = Path::new(&profile.folder);
        if !folder.is_dir() {
            return Err("The sync drive or folder is disconnected. Reconnect it, or choose its new location in Data Sync settings.".into());
        }
        let root = folder.join(DIRECTORY);
        if !root.is_dir() {
            if !create || profile.repository_id.is_some() {
                return Err("The configured sync repository is missing. Select the correct folder in Data Sync settings.".into());
            }
            fs::create_dir(&root).map_err(io_error)?;
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("lock"))
            .map_err(io_error)?;
        FileExt::try_lock(&lock).map_err(|_| {
            "The sync repository is in use by another process. Try again when it finishes."
                .to_string()
        })?;
        let mp = root.join("repository.json");
        let manifest: Manifest = if mp.exists() {
            read_json(&mp)?
        } else {
            if profile.repository_id.is_some() || !create {
                return Err("The sync repository manifest is missing.".into());
            }
            let m = Manifest {
                format: FORMAT,
                repository_id: Uuid::new_v4().to_string(),
            };
            write_atomic(&mp, &serde_json::to_vec(&m).map_err(|e| e.to_string())?)?;
            m
        };
        if manifest.format != FORMAT {
            return Err("This sync repository requires a different app version. Update Projects Runner on both devices.".into());
        }
        if profile
            .repository_id
            .as_ref()
            .is_some_and(|id| id != &manifest.repository_id)
        {
            return Err("This drive contains a different sync repository. Choose the correct folder in Data Sync settings.".into());
        }
        fs::create_dir_all(root.join("revisions")).map_err(io_error)?;
        fs::create_dir_all(root.join("assets")).map_err(io_error)?;
        Ok(Self {
            root,
            manifest,
            expected_revision: profile.last_revision_id.clone(),
            _lock: lock,
        })
    }
    fn head(&self) -> Result<Option<Revision>, String> {
        let mut revisions = BTreeMap::new();
        for entry in fs::read_dir(self.root.join("revisions")).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let envelope: Envelope = read_json(&path)?;
            let r = envelope.revision;
            if fingerprint(&r)? != envelope.checksum
                || r.repository_id != self.manifest.repository_id
                || r.format != FORMAT
                || path.file_stem().and_then(|s| s.to_str()) != Some(r.id.as_str())
            {
                return Err("A published sync revision is damaged. No data was changed. Restore the drive from a valid backup.".into());
            }
            validate_snapshot(&r.snapshot)?;
            revisions.insert(r.id.clone(), r);
        }
        if self
            .expected_revision
            .as_ref()
            .is_some_and(|id| !revisions.contains_key(id))
        {
            return Err("The sync folder is older than the last successful sync or is missing a revision. No data was changed. Restore the latest repository copy.".into());
        }
        let mut children = BTreeMap::<String, usize>::new();
        let mut roots = 0;
        for r in revisions.values() {
            if let Some(parent) = &r.parent {
                let p = revisions
                    .get(parent)
                    .ok_or("A sync revision is missing its parent. No data was changed.")?;
                if p.generation + 1 != r.generation {
                    return Err("Invalid sync revision sequence.".into());
                }
                *children.entry(parent.clone()).or_default() += 1;
            } else {
                roots += 1;
                if r.generation != 1 {
                    return Err("Invalid initial sync revision.".into());
                }
            }
        }
        if roots > 1 || children.values().any(|n| *n > 1) {
            return Err("The sync repository has diverging revisions. Restore a consistent copy before syncing.".into());
        }
        Ok(revisions.into_values().max_by_key(|r| r.generation))
    }
    fn publish(&self, r: &Revision, assets: &BTreeMap<String, Vec<u8>>) -> Result<(), String> {
        for (sha, bytes) in assets {
            let path = self.root.join("assets").join(sha);
            if !path.exists() {
                write_atomic(&path, bytes)?;
            }
        }
        for record in r.snapshot.records.values().filter(|r| r.kind == "avatar") {
            if let Some(sha) = record.data.get("sha256").and_then(Value::as_str) {
                self.asset(sha)?;
            }
        }
        // Recheck the identity immediately before publishing, including after an unplug/replug.
        let m: Manifest = read_json(&self.root.join("repository.json"))?;
        if m.repository_id != r.repository_id {
            return Err("The connected sync repository changed. Try again.".into());
        }
        if self.head()?.as_ref().map(|head| &head.id) != r.parent.as_ref() {
            return Err(
                "The sync folder changed while reviewing. Refresh the sync preview.".into(),
            );
        }
        let bytes = serde_json::to_vec(&Envelope {
            checksum: fingerprint(r)?,
            revision: r.clone(),
        })
        .map_err(|e| e.to_string())?;
        write_atomic(
            &self.root.join("revisions").join(format!("{}.json", r.id)),
            &bytes,
        )
    }
    fn asset(&self, sha: &str) -> Result<Vec<u8>, String> {
        if sha.len() != 64 || !sha.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid avatar checksum in sync repository.".into());
        }
        let bytes = fs::read(self.root.join("assets").join(sha)).map_err(io_error)?;
        if hash(&bytes) != sha {
            return Err("An avatar in the sync repository is damaged. No data was changed.".into());
        }
        Ok(bytes)
    }
}

fn capture(
    conn: &mut SqliteConnection,
    paths: &AppPaths,
    repo: &str,
    prefs: &Preferences,
    scopes: &SyncScopes,
) -> Result<(Snapshot, BTreeMap<String, Vec<u8>>), String> {
    let mut s = Snapshot::default();
    let mut assets = BTreeMap::new();
    let projects = if scopes.projects {
        rows(conn,"SELECT json_object('id',id,'name',name,'path',path,'description',description,'notes',notes,'avatar',avatar_path,'created_at',created_at) AS value FROM projects ORDER BY id")?
    } else {
        Vec::new()
    };
    for p in projects {
        let pid = p["id"].to_string();
        let uuid = identity(conn, repo, "project", &pid)?;
        let types=rows(conn,&format!("SELECT json_object('relative_path',relative_path,'project_type_id',project_type_id) AS value FROM folder_dev_project_types WHERE project_id={pid} ORDER BY relative_path,project_type_id"))?;
        s.paths.insert(uuid.clone(), text(&p, "path").to_string());
        s.records.insert(uuid.clone(),Record {kind:"project".into(),project:None,data:json!({"name":p["name"],"description":p["description"],"created_at":p["created_at"],"folder_types":types})});
        if scopes.avatars {
            capture_avatar(
                &mut s,
                &mut assets,
                &uuid,
                &uuid,
                "project",
                p.get("avatar").and_then(Value::as_str),
            )?;
        }
        let notes = if scopes.notes {
            parse_notes(
                p.get("notes").and_then(Value::as_str),
                text(&p, "created_at"),
            )?
        } else {
            Vec::new()
        };
        for mut note in notes {
            let note_id = text(&note, "id").to_string();
            let nid = identity(conn, repo, "note", &format!("{pid}:{note_id}"))?;
            note.as_object_mut().ok_or("Invalid note")?.remove("id");
            s.records.insert(
                nid,
                Record {
                    kind: "note".into(),
                    project: Some(uuid.clone()),
                    data: note,
                },
            );
        }
        for mut command in rows(conn,&format!("SELECT json_object('id',id,'name',name,'script',script,'avatar',avatar_path,'ports',ports,'section',section,'order_index',order_index,'runtime_mode',runtime_mode,'run_in_external_terminal',run_in_external_terminal,'external_terminal_kind',external_terminal_kind,'interactive_terminal_kind',interactive_terminal_kind,'created_at',created_at,'updated_at',updated_at) AS value FROM commands WHERE project_id={pid} ORDER BY id"))? {
            let key=command["id"].to_string(); let cid=identity(conn,repo,"command",&key)?;
            if scopes.avatars {capture_avatar(&mut s,&mut assets,&cid,&uuid,"command",command.get("avatar").and_then(Value::as_str))?;}
            let obj=command.as_object_mut().unwrap(); obj.remove("id"); obj.remove("avatar");
            s.records.insert(cid,Record{kind:"command".into(),project:Some(uuid.clone()),data:command});
        }
        for mut section in rows(conn,&format!("SELECT json_object('id',id,'name',name,'order_index',order_index,'created_at',created_at,'updated_at',updated_at) AS value FROM command_sections WHERE project_id={pid} ORDER BY id"))? {
            let sid=identity(conn,repo,"section",&section["id"].to_string())?;
            section.as_object_mut().unwrap().remove("id");
            s.records.insert(sid,Record{kind:"section".into(),project:Some(uuid.clone()),data:section});
        }
    }
    for key in PREFERENCE_KEYS {
        if let Some(value) = prefs.get(*key) {
            s.records.insert(
                format!("pref:{key}"),
                Record {
                    kind: "preference".into(),
                    project: None,
                    data: json!({"key":key,"value":value}),
                },
            );
        }
    }
    let _ = paths;
    Ok((s, assets))
}
fn parse_notes(raw: Option<&str>, time: &str) -> Result<Vec<Value>, String> {
    let Some(raw) = raw.filter(|s| !s.trim().is_empty()) else {
        return Ok(Vec::new());
    };
    let value = serde_json::from_str::<Value>(raw);
    let items = match value {
        Ok(Value::Array(items)) => items,
        _ => vec![
            json!({"id":"legacy","title":"","content":raw,"pinned":false,"createdAt":time,"updatedAt":time}),
        ],
    };
    for item in &items {
        if item.get("id").and_then(Value::as_str).is_none()
            || item.get("content").and_then(Value::as_str).is_none()
        {
            return Err("A local note is invalid. Repair it before syncing.".into());
        }
    }
    Ok(items)
}
fn capture_avatar(
    s: &mut Snapshot,
    assets: &mut BTreeMap<String, Vec<u8>>,
    owner: &str,
    project: &str,
    owner_kind: &str,
    path: Option<&str>,
) -> Result<(), String> {
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        return Ok(());
    };
    let data = if is_icon(path) {
        json!({"owner":owner,"owner_kind":owner_kind,"icon":path})
    } else {
        let bytes = fs::read(path).map_err(|e| format!("Unable to read avatar {path}: {e}"))?;
        let sha = hash(&bytes);
        assets.insert(sha.clone(), bytes);
        json!({"owner":owner,"owner_kind":owner_kind,"sha256":sha})
    };
    s.records.insert(
        format!("avatar:{owner}"),
        Record {
            kind: "avatar".into(),
            project: Some(project.into()),
            data,
        },
    );
    Ok(())
}
fn is_icon(value: &str) -> bool {
    ["lucide:", "devicon:"].iter().any(|prefix| {
        value.strip_prefix(prefix).is_some_and(|id| {
            !id.is_empty()
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
    })
}

fn validate_preferences(prefs: &Preferences) -> Result<(), String> {
    for (key, value) in prefs {
        let valid = match key.as_str() {
            "theme" => ["dark", "light", "system"].contains(&value.as_str()),
            "accent" => ["mono", "blue"].contains(&value.as_str()),
            "dateFormat" => ["dd/mm/yyyy", "mm/dd/yyyy"].contains(&value.as_str()),
            "terminalFontSize" => value.len() <= 64 && !value.chars().any(char::is_control),
            "terminalFontFamily" => {
                ["System Mono", "Consolas", "SF Mono", "Monospace"].contains(&value.as_str())
            }
            "autoClearLogs"
            | "showLogsTimestamp"
            | "showStreamName"
            | "explorerAllowMultipleOpen"
            | "restoreOpenTabs" => ["true", "false"].contains(&value.as_str()),
            _ => false,
        };
        if !valid {
            return Err(format!("Invalid synced app preference: {key}"));
        }
    }
    Ok(())
}
fn validate_snapshot(s: &Snapshot) -> Result<(), String> {
    let mut prefs = Preferences::new();
    let mut section_names = BTreeSet::new();
    for (id, r) in &s.records {
        if id.is_empty() || !r.data.is_object() {
            return Err("Invalid sync record.".into());
        }
        if r.kind != "project" && r.kind != "preference" {
            let parent = r.project.as_ref().and_then(|p| s.records.get(p));
            if !parent.is_some_and(|p| p.kind == "project") {
                return Err(
                    "A sync item is missing its project. Resolve the project deletion first."
                        .into(),
                );
            }
        }
        let required: &[&str] = match r.kind.as_str() {
            "project" => &["name", "created_at"],
            "command" => &[
                "name",
                "script",
                "ports",
                "section",
                "runtime_mode",
                "external_terminal_kind",
                "interactive_terminal_kind",
                "created_at",
                "updated_at",
            ],
            "section" => &["name", "created_at", "updated_at"],
            "note" => &["content"],
            "avatar" => &["owner", "owner_kind"],
            "preference" => &["key", "value"],
            _ => return Err("Unknown record type in sync repository.".into()),
        };
        if required
            .iter()
            .any(|key| r.data.get(*key).and_then(Value::as_str).is_none())
        {
            return Err(format!("Invalid {} in sync repository.", r.kind));
        }
        if r.kind == "section"
            && !section_names.insert((
                r.project.clone(),
                text(&r.data, "name").to_ascii_lowercase(),
            ))
        {
            return Err(format!(
                "Two command groups are named ‘{}’ in the same project. Rename one of these groups on either device, then sync again. No data was changed.",
                text(&r.data, "name")
            ));
        }
        if r.kind == "avatar" {
            let owner = s.records.get(text(&r.data, "owner"));
            if !owner.is_some_and(|o| {
                o.kind == text(&r.data, "owner_kind")
                    && (o.kind == "project" || o.kind == "command")
            }) && !(text(&r.data, "owner_kind") == "command" && owner.is_none())
            {
                return Err("An avatar has an invalid owner.".into());
            }
            if let Some(icon) = r.data.get("icon").and_then(Value::as_str) {
                if !is_icon(icon) {
                    return Err("Invalid avatar icon.".into());
                }
            } else {
                let sha = text(&r.data, "sha256");
                if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Invalid avatar asset.".into());
                }
            }
        }
        if r.kind == "preference" {
            prefs.insert(text(&r.data, "key").into(), text(&r.data, "value").into());
        }
        if s.tombstones.contains_key(id) {
            return Err("A sync item is both present and deleted.".into());
        }
    }
    validate_preferences(&prefs)
}

fn candidates(local: &Snapshot, remote: &Snapshot, baseline: &Snapshot) -> Vec<SyncLinkCandidate> {
    let mut result = Vec::new();
    for (lid, l) in local.records.iter().filter(|(_, r)| r.kind == "project") {
        if baseline.records.contains_key(lid)
            || remote.records.contains_key(lid)
            || remote.tombstones.contains_key(lid)
        {
            continue;
        }
        for (rid, r) in remote.records.iter().filter(|(_, r)| r.kind == "project") {
            if local.records.contains_key(rid) {
                continue;
            }
            let names = text(&l.data, "name").eq_ignore_ascii_case(text(&r.data, "name"));
            let paths = local
                .paths
                .get(lid)
                .zip(remote.paths.get(rid))
                .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
            if names || paths {
                result.push(SyncLinkCandidate {
                    local_id: lid.clone(),
                    remote_id: rid.clone(),
                    local_label: format!(
                        "{} · {}",
                        l.label(),
                        local.paths.get(lid).map(String::as_str).unwrap_or("")
                    ),
                    remote_label: format!(
                        "{} · {}",
                        r.label(),
                        remote.paths.get(rid).map(String::as_str).unwrap_or("")
                    ),
                });
            }
        }
    }
    result
}
fn remap(s: &Snapshot, links: &[SyncLink]) -> Snapshot {
    let map: BTreeMap<_, _> = links
        .iter()
        .map(|l| (l.local_id.clone(), l.remote_id.clone()))
        .collect();
    let replace = |id: &str| map.get(id).cloned().unwrap_or_else(|| id.into());
    let mut result = Snapshot::default();
    for (id, record) in &s.records {
        let mut r = record.clone();
        r.project = r.project.as_deref().map(&replace);
        let key = if r.kind == "avatar" {
            let owner = replace(text(&r.data, "owner"));
            r.data["owner"] = json!(owner);
            format!("avatar:{owner}")
        } else {
            replace(id)
        };
        result.records.insert(key, r);
    }
    result.paths = s
        .paths
        .iter()
        .map(|(id, path)| (replace(id), path.clone()))
        .collect();
    result
}
fn expand_links(
    local: &Snapshot,
    remote: &Snapshot,
    links: Vec<SyncLink>,
) -> Result<Vec<SyncLink>, String> {
    let mut all = links;
    let mut used = BTreeSet::new();
    let mut used_local = BTreeSet::new();
    for link in &all {
        if !used_local.insert(link.local_id.clone())
            || !used.insert(link.remote_id.clone())
            || !local
                .records
                .get(&link.local_id)
                .is_some_and(|r| r.kind == "project")
            || !remote
                .records
                .get(&link.remote_id)
                .is_some_and(|r| r.kind == "project")
            || local.records.contains_key(&link.remote_id)
        {
            return Err("Invalid or duplicate project link. Review the project matches.".into());
        }
    }
    let projects = all.clone();
    for link in projects {
        for (lid, l) in local.records.iter().filter(|(_, r)| {
            r.project.as_deref() == Some(&link.local_id)
                && ["command", "section", "note"].contains(&r.kind.as_str())
        }) {
            let matches: Vec<_> = remote
                .records
                .iter()
                .filter(|(_, r)| {
                    r.kind == l.kind
                        && r.project.as_deref() == Some(&link.remote_id)
                        && if l.kind == "note" {
                            !text(&l.data, "title").is_empty()
                                && text(&l.data, "title") == text(&r.data, "title")
                                || l.data == r.data
                        } else {
                            text(&l.data, "name").eq_ignore_ascii_case(text(&r.data, "name"))
                                && (l.kind != "command"
                                    || text(&l.data, "section")
                                        .eq_ignore_ascii_case(text(&r.data, "section")))
                        }
                })
                .collect();
            if matches.len() == 1 && used.insert(matches[0].0.clone()) {
                all.push(SyncLink {
                    local_id: lid.clone(),
                    remote_id: matches[0].0.clone(),
                });
            }
        }
    }
    Ok(all)
}

// Sections are unique by (project, name) in SQLite. Two offline devices can
// independently add the same group with different UUIDs; reconcile that identity
// before comparing versions, while preserving both devices' numeric IDs.
fn new_section_links(local: &Snapshot, remote: &Snapshot, base: &Snapshot) -> Vec<SyncLink> {
    let is_new = |id: &String| !base.records.contains_key(id) && !base.tombstones.contains_key(id);
    let mut used = BTreeSet::new();
    let mut links = Vec::new();
    for (lid, l) in local
        .records
        .iter()
        .filter(|(id, r)| r.kind == "section" && is_new(id) && !remote.records.contains_key(*id))
    {
        if let Some((rid, _)) = remote.records.iter().find(|(id, r)| {
            r.kind == "section"
                && is_new(id)
                && !local.records.contains_key(*id)
                && !used.contains(*id)
                && r.project == l.project
                && text(&r.data, "name").eq_ignore_ascii_case(text(&l.data, "name"))
        }) {
            used.insert(rid.clone());
            links.push(SyncLink {
                local_id: lid.clone(),
                remote_id: rid.clone(),
            });
        }
    }
    links
}

fn merge(
    base: &Snapshot,
    local: &Snapshot,
    remote: &Snapshot,
    scopes: &SyncScopes,
    choices: &Choices,
) -> Result<(Snapshot, Vec<SyncConflict>), String> {
    let mut out = remote.clone();
    let mut conflicts = Vec::new();
    let keys: BTreeSet<_> = base
        .records
        .keys()
        .chain(base.tombstones.keys())
        .chain(local.records.keys())
        .chain(remote.records.keys())
        .chain(remote.tombstones.keys())
        .cloned()
        .collect();
    let mut tree_choices = BTreeMap::new();
    // Deleting an owner conflicts with edits anywhere in its subtree.
    for id in &keys {
        let b = base.records.get(id);
        let l = local.records.get(id);
        let r = remote.records.get(id);
        let Some(project) = l
            .or(r)
            .or(b)
            .filter(|r| r.kind == "project" || r.kind == "command")
        else {
            continue;
        };
        if !scopes.includes(&project.kind) || b.is_none() || l.is_some() == r.is_some() {
            continue;
        }
        let survivor = if l.is_some() { local } else { remote };
        let edited = survivor.records.iter().any(|(key, item)| {
            scopes.includes(&item.kind)
                && (if project.kind == "project" {
                    item.project.as_deref() == Some(id)
                } else {
                    item.kind == "avatar" && text(&item.data, "owner") == id
                })
                && base.records.get(key) != Some(item)
        });
        if edited {
            let choice = choices.get(id).map(String::as_str);
            if !matches!(choice, Some("local" | "remote")) {
                conflicts.push(SyncConflict {
                    id: id.clone(),
                    kind: project.kind.clone(),
                    label: format!("{} ({} and contents)", project.label(), project.kind),
                    local: l.map(|p| conflict_tree(p, id, local, base).to_string()),
                    remote: r.map(|p| conflict_tree(p, id, remote, base).to_string()),
                });
            }
            tree_choices.insert(id.clone(), choice.unwrap_or("remote").to_string());
        }
    }
    for id in keys {
        let b = base.records.get(&id);
        let l = local.records.get(&id);
        let r = remote.records.get(&id);
        let Some(info) = l
            .or(r)
            .or(b)
            .or_else(|| remote.tombstones.get(&id))
            .or_else(|| base.tombstones.get(&id))
        else {
            continue;
        };
        if !scopes.includes(&info.kind) {
            continue;
        }
        let tree = info
            .project
            .as_ref()
            .and_then(|p| tree_choices.get(p))
            .or_else(|| tree_choices.get(&id))
            .or_else(|| {
                if info.kind == "avatar" {
                    tree_choices.get(text(&info.data, "owner"))
                } else {
                    None
                }
            });
        let selected = if let Some(side) = tree {
            if side == "local" {
                l
            } else {
                r
            }
        } else if l == r {
            l
        } else if l == b {
            r
        } else if r == b {
            l
        } else {
            match choices.get(&id).map(String::as_str) {
                Some("local") => l,
                Some("remote") => r,
                _ => {
                    conflicts.push(SyncConflict {
                        id: id.clone(),
                        kind: info.kind.clone(),
                        label: info.label(),
                        local: l.map(|p| p.data.to_string()),
                        remote: r.map(|p| p.data.to_string()),
                    });
                    r
                }
            }
        };
        if let Some(value) = selected {
            out.records.insert(id.clone(), value.clone());
            out.tombstones.remove(&id);
        } else {
            out.records.remove(&id);
            out.tombstones.insert(id.clone(), info.clone());
        }
    }
    // Path hints are only used on first arrival; a local path change isn't a sync edit.
    for (id, path) in &local.paths {
        out.paths.entry(id.clone()).or_insert_with(|| path.clone());
    }
    if conflicts.is_empty() {
        let orphaned: Vec<_> = out
            .records
            .iter()
            .filter(|(_, r)| {
                r.project
                    .as_ref()
                    .is_some_and(|p| !out.records.contains_key(p))
            })
            .map(|(id, r)| (id.clone(), r.clone()))
            .collect();
        for (id, r) in orphaned {
            if !scopes.includes(&r.kind) {
                return Err(format!(
                    "Enable {} synchronization before deleting its project.",
                    r.kind
                ));
            }
            out.records.remove(&id);
            out.tombstones.insert(id, r);
        }
        let avatars: Vec<_> = out
            .records
            .iter()
            .filter(|(_, r)| {
                r.kind == "avatar" && out.tombstones.contains_key(text(&r.data, "owner"))
            })
            .map(|(id, r)| (id.clone(), r.clone()))
            .collect();
        for (id, r) in avatars {
            if !scopes.avatars {
                return Err("Enable Avatars synchronization before deleting this command.".into());
            }
            out.records.remove(&id);
            out.tombstones.insert(id, r);
        }
        if scopes.commands {
            let sections: Vec<_> = out
                .records
                .values()
                .filter(|r| r.kind == "section")
                .map(|r| (r.project.clone(), text(&r.data, "name").to_string()))
                .collect();
            for r in out.records.values_mut().filter(|r| r.kind == "command") {
                if let Some((_, name)) = sections.iter().find(|(project, name)| {
                    project == &r.project && name.eq_ignore_ascii_case(text(&r.data, "section"))
                }) {
                    r.data["section"] = json!(name);
                }
            }
        }
    }
    Ok((out, conflicts))
}

fn conflict_tree(owner: &Record, id: &str, snapshot: &Snapshot, base: &Snapshot) -> Value {
    let mut value = owner.data.clone();
    let changed: Vec<_> = snapshot
        .records
        .iter()
        .filter(|(key, r)| {
            base.records.get(*key) != Some(*r)
                && (if owner.kind == "project" {
                    r.project.as_deref() == Some(id)
                } else {
                    r.kind == "avatar" && text(&r.data, "owner") == id
                })
        })
        .map(|(_, r)| r.data.clone())
        .collect();
    value["changed_contents"] = json!(changed);
    value
}

fn decorate_conflicts(
    conflicts: &mut [SyncConflict],
    local: &Snapshot,
    remote: &Snapshot,
    assets: &BTreeMap<String, Vec<u8>>,
    repository: &Repository,
) -> Result<(), String> {
    use base64::Engine;
    for c in conflicts {
        let info = local
            .records
            .get(&c.id)
            .or_else(|| remote.records.get(&c.id));
        if let Some(info) = info {
            let project = info
                .project
                .as_ref()
                .and_then(|id| local.records.get(id).or_else(|| remote.records.get(id)));
            if let Some(project) = project {
                c.label = format!("{} · {}", project.label(), c.label);
            }
            if c.kind == "avatar" {
                let owner_id = text(&info.data, "owner");
                if let Some(owner) = local
                    .records
                    .get(owner_id)
                    .or_else(|| remote.records.get(owner_id))
                {
                    c.label = format!("{} · Avatar", owner.label());
                }
            }
        }
        if c.kind != "avatar" {
            continue;
        }
        for raw in [&mut c.local, &mut c.remote] {
            let Some(value) = raw else {
                continue;
            };
            let mut data: Value = serde_json::from_str(value).map_err(|e| e.to_string())?;
            if let Some(sha) = data.get("sha256").and_then(Value::as_str) {
                let bytes = if let Some(bytes) = assets.get(sha) {
                    bytes.clone()
                } else {
                    repository.asset(sha)?
                };
                let mime = match image::guess_format(&bytes).map_err(|e| e.to_string())? {
                    image::ImageFormat::Png => "image/png",
                    image::ImageFormat::Jpeg => "image/jpeg",
                    image::ImageFormat::WebP => "image/webp",
                    image::ImageFormat::Gif => "image/gif",
                    _ => return Err("Unsupported synced avatar format.".into()),
                };
                data["preview"] = json!(format!(
                    "data:{mime};base64,{}",
                    crate::BASE64_STANDARD.encode(bytes)
                ));
                *value = data.to_string();
            }
        }
    }
    Ok(())
}

fn sql_value(value: &Value) -> Result<String, String> {
    match value {
        Value::Null => Ok("NULL".into()),
        Value::String(s) => Ok(format!("'{}'", crate::quote_sql(s))),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(if *b { "1" } else { "0" }.into()),
        _ => Err("Unexpected structured value in sync record.".into()),
    }
}
fn upsert_row(
    conn: &mut SqliteConnection,
    repo: &str,
    kind: &str,
    uuid: &str,
    table: &str,
    fields: &[(&str, Value)],
) -> Result<i64, String> {
    let existing = local_key(conn, repo, kind, uuid)?.and_then(|s| s.parse::<i64>().ok());
    // Deleted local IDs may remain in the identity map until their tombstone is reconciled.
    let exists = if let Some(id) = existing {
        !rows(
            conn,
            &format!("SELECT json_object('id',id) AS value FROM {table} WHERE id={id}"),
        )?
        .is_empty()
    } else {
        false
    };
    if exists {
        let assignments = fields
            .iter()
            .map(|(key, v)| Ok(format!("{key}={}", sql_value(v)?)))
            .collect::<Result<Vec<_>, String>>()?
            .join(",");
        sql_query(format!(
            "UPDATE {table} SET {assignments} WHERE id={}",
            existing.unwrap()
        ))
        .execute(conn)
        .map_err(|e| e.to_string())?;
        Ok(existing.unwrap())
    } else {
        let names = fields.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(",");
        let values = fields
            .iter()
            .map(|(_, v)| sql_value(v))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        sql_query(format!("INSERT INTO {table}({names}) VALUES({values})"))
            .execute(conn)
            .map_err(|e| e.to_string())?;
        let id = rows(
            conn,
            "SELECT json_object('id',last_insert_rowid()) AS value",
        )?[0]["id"]
            .as_i64()
            .ok_or("Unable to allocate local sync ID")?;
        bind_identity(conn, repo, kind, &id.to_string(), uuid)?;
        Ok(id)
    }
}
fn deletion_guards(local: &Snapshot, merged: &Snapshot, scopes: &SyncScopes) -> Result<(), String> {
    for (id, r) in &local.records {
        if r.kind == "project" && scopes.projects && !merged.records.contains_key(id) {
            for child in local
                .records
                .values()
                .filter(|c| c.project.as_ref() == Some(id))
            {
                if !scopes.includes(&child.kind) {
                    return Err(format!(
                        "Enable {} synchronization before deleting project ‘{}’.",
                        child.kind,
                        r.label()
                    ));
                }
            }
            // Avatars aren't read when their scope is off; the SQL guard below checks them too.
        }
    }
    Ok(())
}
fn apply(
    conn: &mut SqliteConnection,
    paths: &AppPaths,
    repo: &Repository,
    profile: &Profile,
    snapshot: &Snapshot,
    links: &[SyncLink],
    running: &BTreeSet<i64>,
) -> Result<Preferences, String> {
    let rid = &repo.manifest.repository_id;
    for link in links {
        for kind in ["project", "command", "section", "note"] {
            if let Some(key) = local_key(conn, rid, kind, &link.local_id)? {
                bind_identity(conn, rid, kind, &key, &link.remote_id)?;
            }
        }
    }
    let mut project_ids = BTreeMap::new();
    let timestamp = crate::now();
    if profile.scopes.projects {
        for (uuid, r) in snapshot.records.iter().filter(|(_, r)| r.kind == "project") {
            let key = local_key(conn, rid, "project", uuid)?;
            let existing = if let Some(key) = &key {
                rows(
                    conn,
                    &format!(
                        "SELECT json_object('path',path) AS value FROM projects WHERE id={}",
                        key.parse::<i64>().map_err(|e| e.to_string())?
                    ),
                )?
            } else {
                Vec::new()
            };
            let path = existing
                .first()
                .map(|v| text(v, "path").to_string())
                .or_else(|| snapshot.paths.get(uuid).cloned())
                .unwrap_or_default();
            let id = upsert_row(
                conn,
                rid,
                "project",
                uuid,
                "projects",
                &[
                    ("name", r.data["name"].clone()),
                    ("description", r.data["description"].clone()),
                    ("path", json!(path)),
                    ("created_at", r.data["created_at"].clone()),
                    ("updated_at", json!(timestamp)),
                ],
            )?;
            project_ids.insert(uuid.clone(), id);
            sql_query(format!(
                "DELETE FROM folder_dev_project_types WHERE project_id={id}"
            ))
            .execute(conn)
            .map_err(|e| e.to_string())?;
            if let Some(types) = r.data.get("folder_types").and_then(Value::as_array) {
                for t in types {
                    sql_query("INSERT INTO folder_dev_project_types(project_id,relative_path,project_type_id,created_at,updated_at) VALUES(?,?,?,?,?)")
                        .bind::<diesel::sql_types::BigInt,_>(id).bind::<Text,_>(text(t,"relative_path")).bind::<Text,_>(text(t,"project_type_id"))
                        .bind::<Text,_>(&timestamp).bind::<Text,_>(&timestamp).execute(conn).map_err(|e|e.to_string())?;
                }
            }
        }
    }
    if profile.scopes.commands {
        // Names have a unique constraint. Stage existing names before applying renames/swaps.
        for (uuid, _) in snapshot
            .records
            .iter()
            .chain(snapshot.tombstones.iter())
            .filter(|(_, r)| r.kind == "section")
        {
            if let Some(key) = local_key(conn, rid, "section", uuid)? {
                let id = key.parse::<i64>().map_err(|e| e.to_string())?;
                sql_query(format!(
                    "UPDATE command_sections SET name='__sync_{}' WHERE id={id}",
                    Uuid::new_v4()
                ))
                .execute(conn)
                .map_err(|e| e.to_string())?;
            }
        }
        for kind in ["section", "command"] {
            for (uuid, r) in snapshot.records.iter().filter(|(_, r)| r.kind == kind) {
                let project_id = *project_ids
                    .get(r.project.as_ref().ok_or("Missing sync project")?)
                    .ok_or("Missing local project")?;
                let keys: &[&str] = if kind == "command" {
                    &[
                        "name",
                        "script",
                        "ports",
                        "section",
                        "order_index",
                        "runtime_mode",
                        "run_in_external_terminal",
                        "external_terminal_kind",
                        "interactive_terminal_kind",
                        "created_at",
                        "updated_at",
                    ]
                } else {
                    &["name", "order_index", "created_at", "updated_at"]
                };
                let mut fields: Vec<_> = keys.iter().map(|k| (*k, r.data[*k].clone())).collect();
                fields.push(("project_id", json!(project_id)));
                upsert_row(
                    conn,
                    rid,
                    kind,
                    uuid,
                    if kind == "command" {
                        "commands"
                    } else {
                        "command_sections"
                    },
                    &fields,
                )?;
            }
        }
    }
    if profile.scopes.notes {
        for (uuid, id) in &project_ids {
            let mut notes = Vec::new();
            for (nid, r) in snapshot
                .records
                .iter()
                .filter(|(_, r)| r.kind == "note" && r.project.as_ref() == Some(uuid))
            {
                let key = local_key(conn, rid, "note", nid)?;
                let note_id = key
                    .as_deref()
                    .and_then(|s| s.split_once(':'))
                    .map(|(_, id)| id.to_string())
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                bind_identity(conn, rid, "note", &format!("{id}:{note_id}"), nid)?;
                let mut note = r.data.clone();
                note["id"] = json!(note_id);
                notes.push(note);
            }
            sql_query("UPDATE projects SET notes=? WHERE id=?")
                .bind::<Text, _>(serde_json::to_string(&notes).map_err(|e| e.to_string())?)
                .bind::<diesel::sql_types::BigInt, _>(*id)
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
    }
    if profile.scopes.avatars {
        for (uuid, r) in snapshot.records.iter().filter(|(_, r)| r.kind == "avatar") {
            let _ = uuid;
            let kind = text(&r.data, "owner_kind");
            // A command can be excluded while avatars remain selected. Never invent the command.
            let Some(key) = local_key(conn, rid, kind, text(&r.data, "owner"))? else {
                continue;
            };
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            let path = if let Some(icon) = r.data.get("icon").and_then(Value::as_str) {
                icon.to_string()
            } else {
                let sha = text(&r.data, "sha256");
                let bytes = repo.asset(sha)?;
                let path = paths.avatars_dir.join(format!(
                    "sync-{sha}.{}",
                    match image::guess_format(&bytes)
                        .map_err(|e| format!("Invalid avatar image: {e}"))?
                    {
                        image::ImageFormat::Png => "png",
                        image::ImageFormat::Jpeg => "jpg",
                        image::ImageFormat::WebP => "webp",
                        image::ImageFormat::Gif => "gif",
                        _ => return Err("Unsupported synced avatar image format.".into()),
                    }
                ));
                if !path.exists() {
                    write_atomic(&path, &bytes)?;
                }
                path.to_string_lossy().to_string()
            };
            let table = if kind == "project" {
                "projects"
            } else {
                "commands"
            };
            sql_query(format!("UPDATE {table} SET avatar_path=? WHERE id={id}"))
                .bind::<Text, _>(path)
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
        for r in snapshot.tombstones.values().filter(|r| r.kind == "avatar") {
            let kind = text(&r.data, "owner_kind");
            if let Some(key) = local_key(conn, rid, kind, text(&r.data, "owner"))? {
                let id = key.parse::<i64>().map_err(|e| e.to_string())?;
                let table = if kind == "project" {
                    "projects"
                } else {
                    "commands"
                };
                sql_query(format!("UPDATE {table} SET avatar_path=NULL WHERE id={id}"))
                    .execute(conn)
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    for kind in ["command", "section", "project"] {
        if !profile.scopes.includes(kind) {
            continue;
        }
        for (uuid, _) in snapshot.tombstones.iter().filter(|(_, r)| r.kind == kind) {
            let Some(key) = local_key(conn, rid, kind, uuid)? else {
                continue;
            };
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            if kind == "command" && running.contains(&id) {
                return Err("Stop the running command before syncing its deletion.".into());
            }
            if kind == "project" {
                let commands=rows(conn,&format!("SELECT json_object('id',id,'avatar',avatar_path) AS value FROM commands WHERE project_id={id}"))?;
                if commands
                    .iter()
                    .any(|c| c["id"].as_i64().is_some_and(|id| running.contains(&id)))
                {
                    return Err(
                        "Stop the project's running commands before syncing its deletion.".into(),
                    );
                }
                let projects=rows(conn,&format!("SELECT json_object('notes',notes,'avatar',avatar_path) AS value FROM projects WHERE id={id}"))?;
                if !profile.scopes.commands && (!commands.is_empty() || !rows(conn,&format!("SELECT json_object('id',id) AS value FROM command_sections WHERE project_id={id}"))?.is_empty()) {return Err("Enable Commands synchronization before deleting this project.".into());}
                if !profile.scopes.notes
                    && projects.iter().any(|p| {
                        p["notes"]
                            .as_str()
                            .is_some_and(|s| s != "[]" && !s.trim().is_empty())
                    })
                {
                    return Err("Enable Notes synchronization before deleting this project.".into());
                }
                if !profile.scopes.avatars
                    && projects
                        .iter()
                        .chain(commands.iter())
                        .any(|p| !p["avatar"].is_null())
                {
                    return Err(
                        "Enable Avatars synchronization before deleting this project.".into(),
                    );
                }
            }
            if kind == "command" && !profile.scopes.avatars {
                if rows(conn,&format!("SELECT json_object('id',id) AS value FROM commands WHERE id={id} AND avatar_path IS NOT NULL"))?.len()>0 {return Err("Enable Avatars synchronization before deleting this command.".into());}
            }
            let table = match kind {
                "project" => "projects",
                "command" => "commands",
                _ => "command_sections",
            };
            sql_query(format!("DELETE FROM {table} WHERE id={id}"))
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
    }
    let mut preferences = Preferences::new();
    if profile.scopes.preferences {
        for r in snapshot.records.values().filter(|r| r.kind == "preference") {
            preferences.insert(text(&r.data, "key").into(), text(&r.data, "value").into());
        }
    }
    validate_preferences(&preferences)?;
    Ok(preferences)
}

fn next_baseline(old: &Snapshot, merged: &Snapshot, scopes: &SyncScopes) -> Snapshot {
    let mut b = old.clone();
    b.records.retain(|_, r| !scopes.includes(&r.kind));
    b.tombstones.retain(|_, r| !scopes.includes(&r.kind));
    b.records.extend(
        merged
            .records
            .iter()
            .filter(|(_, r)| scopes.includes(&r.kind))
            .map(|(k, r)| (k.clone(), r.clone())),
    );
    b.tombstones.extend(
        merged
            .tombstones
            .iter()
            .filter(|(_, r)| scopes.includes(&r.kind))
            .map(|(k, r)| (k.clone(), r.clone())),
    );
    b.paths = merged.paths.clone();
    b
}
fn running_ids(state: &AppState, conn: &mut SqliteConnection) -> Result<BTreeSet<i64>, String> {
    let mut ids: BTreeSet<_> = state
        .terminal_supervisor
        .get_active_command_ids()
        .into_iter()
        .collect();
    for row in rows(conn,"SELECT json_object('command_id',command_id) AS value FROM command_runs WHERE status='running'")? {if let Some(id)=row["command_id"].as_i64(){ids.insert(id);}}
    Ok(ids)
}
fn complete(
    conn: &mut SqliteConnection,
    paths: &AppPaths,
    repository: &Repository,
    journal: &Journal,
    running: &BTreeSet<i64>,
) -> Result<SyncResult, String> {
    let mut c = config(conn)?;
    let mut profile = c
        .profiles
        .get(&journal.profile_key)
        .ok_or("Missing recovery profile")?
        .clone();
    let preferences = apply(
        conn,
        paths,
        repository,
        &profile,
        &journal.revision.snapshot,
        &journal.links,
        running,
    )?;
    profile.baseline = next_baseline(
        &profile.baseline,
        &journal.revision.snapshot,
        &profile.scopes,
    );
    // An avatar may arrive before its command when Commands is excluded on the
    // sending device. Do not acknowledge it as locally present until its owner
    // exists; otherwise the next sync would mistake non-delivery for deletion.
    let mut undelivered = Vec::new();
    for (uuid, record) in profile
        .baseline
        .records
        .iter()
        .filter(|(_, r)| r.kind == "avatar")
    {
        let kind = text(&record.data, "owner_kind");
        let key = local_key(
            conn,
            &journal.revision.repository_id,
            kind,
            text(&record.data, "owner"),
        )?;
        let exists = if let Some(key) = key {
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            let table = if kind == "project" {
                "projects"
            } else {
                "commands"
            };
            !rows(
                conn,
                &format!("SELECT json_object('id',id) AS value FROM {table} WHERE id={id}"),
            )?
            .is_empty()
        } else {
            false
        };
        if !exists {
            undelivered.push(uuid.clone());
        }
    }
    for uuid in undelivered {
        profile.baseline.records.remove(&uuid);
    }
    profile.last_synced_at = Some(crate::now());
    profile.last_revision_id = Some(journal.revision.id.clone());
    c.profiles.insert(journal.profile_key.clone(), profile);
    kv_set(conn, "config", &c)?;
    // Keep preferences durable until the frontend explicitly acknowledges applying them.
    if !preferences.is_empty() {
        kv_set(conn, "preferences", &preferences)?;
    }
    sql_query("DELETE FROM sync_state WHERE key='journal'")
        .execute(conn)
        .map_err(|e| e.to_string())?;
    Ok(SyncResult {
        status: status(conn)?,
        preferences,
    })
}
fn recover(
    conn: &mut SqliteConnection,
    paths: &AppPaths,
    c: &Config,
    running: &BTreeSet<i64>,
) -> Result<(), String> {
    let Some(journal) = kv_get::<Journal>(conn, "journal")? else {
        return Ok(());
    };
    let profile = c
        .profiles
        .get(&journal.profile_key)
        .ok_or("Missing sync recovery profile")?;
    let repository = Repository::open(profile, false)?;
    let path = repository
        .root
        .join("revisions")
        .join(format!("{}.json", journal.revision.id));
    if !path.exists() {
        sql_query("DELETE FROM sync_state WHERE key='journal'")
            .execute(conn)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    repository.head()?; // Validate the complete chain, including the published revision.
                        // The published revision participates in the next normal three-way merge.
                        // Do not replay writes: the user may have edited local data after the failure.
                        // Persist only the identity links already approved for that published revision.
    let _ = (paths, running);
    conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
        for link in &journal.links {
            for kind in ["project", "command", "section", "note"] {
                if let Some(key) =
                    local_key(conn, &journal.revision.repository_id, kind, &link.local_id)
                        .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?
                {
                    bind_identity(
                        conn,
                        &journal.revision.repository_id,
                        kind,
                        &key,
                        &link.remote_id,
                    )
                    .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
                }
            }
        }
        sql_query("DELETE FROM sync_state WHERE key='journal'").execute(conn)?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_get_status(state: State<AppState>) -> Result<SyncStatus, String> {
    status(&mut connect(&state.paths)?)
}
#[tauri::command]
pub fn sync_ack_preferences(
    preferences: Preferences,
    state: State<AppState>,
    service: State<SyncService>,
) -> Result<(), String> {
    let _op = service.operation.lock().map_err(|e| e.to_string())?;
    let mut conn = connect(&state.paths)?;
    let pending = kv_get::<Preferences>(&mut conn, "preferences")?.unwrap_or_default();
    if pending == preferences {
        sql_query("DELETE FROM sync_state WHERE key='preferences'")
            .execute(&mut conn)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn sync_configure(
    folder: Option<String>,
    scopes: SyncScopes,
    state: State<'_, AppState>,
    service: State<'_, SyncService>,
) -> Result<SyncStatus, String> {
    configure_sync(folder, scopes, &state, &service)
}

fn configure_sync(
    folder: Option<String>,
    scopes: SyncScopes,
    state: &AppState,
    service: &SyncService,
) -> Result<SyncStatus, String> {
    let _op = service
        .operation
        .try_lock()
        .map_err(|_| "Synchronization is in progress.")?;
    if service.session.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Finish or cancel the current sync before changing settings.".into());
    }
    if !scopes.projects && (scopes.commands || scopes.notes || scopes.avatars) {
        return Err("Projects must be enabled for dependent data groups.".into());
    }
    let mut conn = connect(&state.paths)?;
    let mut c = config(&mut conn)?;
    let pending_journal = kv_get::<Journal>(&mut conn, "journal")?;
    if let Some(folder) = folder {
        let path = fs::canonicalize(&folder).map_err(io_error)?;
        if !path.is_dir() || path.file_name().is_some_and(|n| n == DIRECTORY) {
            return Err("Choose the parent folder for the sync repository.".into());
        }
        if state
            .paths
            .db_path
            .parent()
            .and_then(|p| fs::canonicalize(p).ok())
            .is_some_and(|p| path.starts_with(p))
        {
            return Err(
                "Choose a sync folder outside the application's working data folder.".into(),
            );
        }
        let folder = path.to_string_lossy().to_string();
        let manifest_path = path.join(DIRECTORY).join("repository.json");
        let manifest = if manifest_path.exists() {
            let m: Manifest = read_json(&manifest_path)?;
            if m.format != FORMAT {
                return Err("Incompatible sync repository version.".into());
            }
            Some(m)
        } else {
            None
        };
        let repo_id = manifest.map(|m| m.repository_id);
        if pending_journal
            .as_ref()
            .is_some_and(|j| repo_id.as_ref() != Some(&j.revision.repository_id))
        {
            return Err("Choose the previous sync repository to finish recovery before switching repositories.".into());
        }
        let key = repo_id.clone().unwrap_or_else(|| format!("new:{folder}"));
        let profile = c.profiles.entry(key.clone()).or_insert_with(|| Profile {
            folder: folder.clone(),
            repository_id: repo_id.clone(),
            scopes: scopes.clone(),
            last_synced_at: None,
            last_revision_id: None,
            baseline: Snapshot::default(),
        });
        profile.folder = folder;
        c.active = Some(key);
    } else if let Some(key) = &c.active {
        if pending_journal.is_some() {
            return Err("Reconnect the previous sync drive and sync once to finish recovery before changing data groups.".into());
        }
        c.profiles
            .get_mut(key)
            .ok_or("Missing sync profile")?
            .scopes = scopes;
    } else {
        return Err("Choose a sync folder first.".into());
    }
    kv_set(&mut conn, "config", &c)?;
    status(&mut conn)
}

#[tauri::command]
pub async fn sync_prepare(
    preferences: Preferences,
    links: Option<Vec<SyncLink>>,
    session_id: Option<String>,
    state: State<'_, AppState>,
    service: State<'_, SyncService>,
) -> Result<SyncPreview, String> {
    prepare_sync(preferences, links, session_id, &state, &service)
}

fn prepare_sync(
    preferences: Preferences,
    links: Option<Vec<SyncLink>>,
    session_id: Option<String>,
    state: &AppState,
    service: &SyncService,
) -> Result<SyncPreview, String> {
    let _op = service
        .operation
        .try_lock()
        .map_err(|_| "Synchronization is in progress.")?;
    validate_preferences(&preferences)?;
    let mut conn = connect(&state.paths)?;
    let mut c = config(&mut conn)?;
    let running = running_ids(&state, &mut conn)?;
    recover(&mut conn, &state.paths, &c, &running)?;
    c = config(&mut conn)?;
    let (mut key, mut profile) = active(&c)?;
    profile.scopes.validate()?;
    let repository = Repository::open(&profile, true)?;
    if profile.repository_id.is_none() {
        let rid = repository.manifest.repository_id.clone();
        profile.repository_id = Some(rid.clone());
        c.profiles.remove(&key);
        key = rid;
        c.profiles.insert(key.clone(), profile.clone());
        c.active = Some(key.clone());
        kv_set(&mut conn, "config", &c)?;
    }
    let head = repository.head()?;
    let remote = head
        .as_ref()
        .map(|r| r.snapshot.clone())
        .unwrap_or_default();
    let (local, assets) = conn
        .immediate_transaction::<_, diesel::result::Error, _>(|conn| {
            capture(
                conn,
                &state.paths,
                &repository.manifest.repository_id,
                &preferences,
                &profile.scopes,
            )
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))
        })
        .map_err(|e| e.to_string())?;
    let requested = links.unwrap_or_default();
    let mut session = service.session.lock().map_err(|e| e.to_string())?;
    if let Some(expected) = session_id.as_ref() {
        if !session
            .as_ref()
            .is_some_and(|s| &s.id == expected && s.profile_key == key)
        {
            return Err("This sync preview has expired. Start syncing again.".into());
        }
    }
    // A webview reload loses its preview ID. A fresh prepare replaces the old
    // session; any late commit/cancel from that review cannot affect the new one.
    let mut all_links = expand_links(&local, &remote, requested)?;
    if profile.scopes.commands {
        all_links.extend(new_section_links(
            &remap(&local, &all_links),
            &remote,
            &profile.baseline,
        ));
    }
    let linked = remap(&local, &all_links);
    let (_, mut conflicts) = merge(
        &profile.baseline,
        &linked,
        &remote,
        &profile.scopes,
        &Choices::new(),
    )?;
    decorate_conflicts(&mut conflicts, &linked, &remote, &assets, &repository)?;
    let links = if session_id.is_none() {
        candidates(&local, &remote, &profile.baseline)
    } else {
        Vec::new()
    };
    let id = Uuid::new_v4().to_string();
    *session = Some(Session {
        id: id.clone(),
        profile_key: key,
        profile,
        head,
        local,
        linked_local: linked,
        links: all_links,
        assets,
    });
    Ok(SyncPreview {
        session_id: id,
        links,
        conflicts,
    })
}

#[tauri::command]
pub async fn sync_commit(
    session_id: String,
    choices: Choices,
    preferences: Preferences,
    state: State<'_, AppState>,
    service: State<'_, SyncService>,
) -> Result<SyncResult, String> {
    commit_sync(session_id, choices, preferences, &state, &service)
}

fn commit_sync(
    session_id: String,
    choices: Choices,
    preferences: Preferences,
    state: &AppState,
    service: &SyncService,
) -> Result<SyncResult, String> {
    let _op = service
        .operation
        .try_lock()
        .map_err(|_| "Synchronization is in progress.")?;
    validate_preferences(&preferences)?;
    let mut guard = service.session.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_ref()
        .filter(|s| s.id == session_id)
        .ok_or("This sync preview has expired. Start syncing again.")?;
    let repository = Repository::open(&session.profile, false)?;
    let head = repository.head()?;
    if head.as_ref().map(|r| &r.id) != session.head.as_ref().map(|r| &r.id) {
        return Err("The sync folder changed while reviewing. Cancel and sync again to refresh the preview.".into());
    }
    let remote = head
        .as_ref()
        .map(|r| r.snapshot.clone())
        .unwrap_or_default();
    let (merged, conflicts) = merge(
        &session.profile.baseline,
        &session.linked_local,
        &remote,
        &session.profile.scopes,
        &choices,
    )?;
    if !conflicts.is_empty() {
        return Err("Choose a version for every conflict before syncing.".into());
    }
    deletion_guards(&session.linked_local, &merged, &session.profile.scopes)?;
    validate_snapshot(&merged)?;
    let mut conn = connect(&state.paths)?;
    let c = config(&mut conn)?;
    let revision = Revision {
        format: FORMAT,
        repository_id: repository.manifest.repository_id.clone(),
        id: Uuid::new_v4().to_string(),
        parent: head.as_ref().map(|r| r.id.clone()),
        generation: head.as_ref().map(|r| r.generation + 1).unwrap_or(1),
        device_id: c.device_id,
        created_at: crate::now(),
        snapshot: merged,
    };
    let journal = Journal {
        profile_key: session.profile_key.clone(),
        revision,
        links: session.links.clone(),
    };
    let running = running_ids(&state, &mut conn)?;
    // Prepare and validate the exact local write under a write transaction, then roll
    // it back. Publication only occurs after this succeeds; no dialog holds a DB lock.
    conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
        let (current, _) = capture(
            conn,
            &state.paths,
            &repository.manifest.repository_id,
            &preferences,
            &session.profile.scopes,
        )
        .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        if current != session.local {
            return Err(diesel::result::Error::QueryBuilderError(
                "Local data changed while reviewing. Cancel and sync again to refresh the preview."
                    .into(),
            ));
        }
        // Publish assets before validating local avatar restoration; unreferenced assets
        // are harmless if the transaction is interrupted.
        for (sha, bytes) in &session.assets {
            let p = repository.root.join("assets").join(sha);
            if !p.exists() {
                write_atomic(&p, bytes)
                    .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
            }
        }
        apply(
            conn,
            &state.paths,
            &repository,
            &session.profile,
            &journal.revision.snapshot,
            &journal.links,
            &running,
        )
        .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        Err::<(), _>(diesel::result::Error::RollbackTransaction)
    })
    .or_else(|e| {
        if matches!(e, diesel::result::Error::RollbackTransaction) {
            Ok(())
        } else {
            Err(e)
        }
    })
    .map_err(|e| e.to_string())?;
    kv_set(&mut conn, "journal", &journal)?;
    let result = conn
        .immediate_transaction::<_, diesel::result::Error, _>(|conn| {
            let (current, _) = capture(
                conn,
                &state.paths,
                &repository.manifest.repository_id,
                &preferences,
                &session.profile.scopes,
            )
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
            if current != session.local {
                return Err(diesel::result::Error::QueryBuilderError(
                    "Local data changed. Cancel and sync again.".into(),
                ));
            }
            repository
                .publish(&journal.revision, &session.assets)
                .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
            #[cfg(test)]
            if service
                .fail_after_publish
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err(diesel::result::Error::QueryBuilderError(
                    "Simulated interruption after publication".into(),
                ));
            }
            complete(conn, &state.paths, &repository, &journal, &running)
                .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))
        })
        .map_err(|e| e.to_string());
    *guard = None;
    result
}
#[tauri::command]
pub fn sync_cancel(session_id: String, service: State<SyncService>) -> Result<(), String> {
    let _op = service
        .operation
        .try_lock()
        .map_err(|_| "Synchronization is in progress.")?;
    let mut session = service.session.lock().map_err(|e| e.to_string())?;
    if session.as_ref().is_some_and(|s| s.id == session_id) {
        *session = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("projects-runner-sync-{}", Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    struct Device {
        _dir: TestDir,
        paths: AppPaths,
    }
    impl Device {
        fn new() -> Self {
            let dir = TestDir::new();
            let paths = AppPaths {
                db_path: dir.0.join("app.sqlite"),
                avatars_dir: dir.0.join("avatars"),
                scripts_dir: dir.0.join("scripts"),
            };
            crate::init_db(&paths).unwrap();
            Self { _dir: dir, paths }
        }
        fn conn(&self) -> SqliteConnection {
            connect(&self.paths).unwrap()
        }
        fn state(&self) -> AppState {
            AppState {
                paths: self.paths.clone(),
                processes: Mutex::new(Default::default()),
                stopped_runs: Mutex::new(Default::default()),
                pending_prd_open_requests: Mutex::new(Vec::new()),
                twofa_vault: std::sync::Arc::new(crate::twofa::VaultService::new()),
                terminal_supervisor: std::sync::Arc::new(
                    crate::terminal_supervisor::TerminalSupervisor::new(),
                ),
            }
        }
        fn execute(&self, sql: &str) {
            self.conn().batch_execute(sql).unwrap();
        }
        fn configure(&self, folder: &Path, repo_id: &str) {
            let mut conn = self.conn();
            let mut c = config(&mut conn).unwrap();
            c.active = Some(repo_id.into());
            c.profiles.insert(
                repo_id.into(),
                Profile {
                    folder: folder.to_string_lossy().into_owned(),
                    repository_id: Some(repo_id.into()),
                    scopes: SyncScopes::default(),
                    baseline: Snapshot::default(),
                    last_synced_at: None,
                    last_revision_id: None,
                },
            );
            kv_set(&mut conn, "config", &c).unwrap();
        }
        fn capture(&self, repo: &str, prefs: &Preferences) -> Snapshot {
            let p = active(&config(&mut self.conn()).unwrap()).unwrap().1;
            capture(&mut self.conn(), &self.paths, repo, prefs, &p.scopes)
                .unwrap()
                .0
        }
        fn sync(
            &self,
            prefs: &Preferences,
            choices: &Choices,
        ) -> Result<Vec<SyncConflict>, String> {
            let mut conn = self.conn();
            let c = config(&mut conn)?;
            let (key, p) = active(&c)?;
            let repo = Repository::open(&p, false)?;
            let head = repo.head()?;
            let remote = head
                .as_ref()
                .map(|r| r.snapshot.clone())
                .unwrap_or_default();
            let (local, assets) = capture(
                &mut conn,
                &self.paths,
                &repo.manifest.repository_id,
                prefs,
                &p.scopes,
            )?;
            let (merged, conflicts) = merge(&p.baseline, &local, &remote, &p.scopes, choices)?;
            if !conflicts.is_empty() {
                return Ok(conflicts);
            }
            deletion_guards(&local, &merged, &p.scopes)?;
            validate_snapshot(&merged)?;
            let revision = Revision {
                format: FORMAT,
                repository_id: repo.manifest.repository_id.clone(),
                id: Uuid::new_v4().to_string(),
                parent: head.as_ref().map(|r| r.id.clone()),
                generation: head.as_ref().map(|r| r.generation + 1).unwrap_or(1),
                device_id: c.device_id,
                created_at: crate::now(),
                snapshot: merged,
            };
            repo.publish(&revision, &assets)?;
            let journal = Journal {
                profile_key: key,
                revision,
                links: Vec::new(),
            };
            kv_set(&mut conn, "journal", &journal)?;
            conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
                complete(conn, &self.paths, &repo, &journal, &BTreeSet::new())
                    .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))
            })
            .map_err(|e| e.to_string())?;
            Ok(Vec::new())
        }
    }
    fn repository(folder: &Path) -> Repository {
        Repository::open(
            &Profile {
                folder: folder.to_string_lossy().into_owned(),
                repository_id: None,
                scopes: SyncScopes::default(),
                baseline: Snapshot::default(),
                last_synced_at: None,
                last_revision_id: None,
            },
            true,
        )
        .unwrap()
    }
    fn seed(d: &Device) {
        d.execute("INSERT INTO projects(id,name,path,description,notes,avatar_path,created_at,updated_at) VALUES(1,'Example','C:/machine-a/project','original','[{\"id\":\"note-1\",\"title\":\"My title\",\"content\":\"body\",\"pinned\":false,\"createdAt\":\"2026-01-01\",\"updatedAt\":\"2026-01-01\"}]','devicon:rust','2026-01-01','2026-01-01');
            INSERT INTO command_sections(id,project_id,name,order_index,created_at,updated_at) VALUES(1,1,'General',0,'2026-01-01','2026-01-01');
            INSERT INTO commands(id,project_id,name,script,section,created_at,updated_at,run_count) VALUES(1,1,'Dev','npm run dev','General','2026-01-01','2026-01-01',7);");
    }
    fn setup() -> (TestDir, String, Device, Device) {
        let dir = TestDir::new();
        let repo = repository(&dir.0);
        let id = repo.manifest.repository_id.clone();
        drop(repo);
        let a = Device::new();
        let b = Device::new();
        a.configure(&dir.0, &id);
        b.configure(&dir.0, &id);
        (dir, id, a, b)
    }
    fn one(conn: &mut SqliteConnection, sql: &str) -> Value {
        rows(conn, sql).unwrap().remove(0)
    }
    #[test]
    fn two_devices_round_trip_preserves_paths_ids_notes_and_run_counts() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        let prefs = Preferences::from([("theme".into(), "dark".into())]);
        assert!(a.sync(&prefs, &Choices::new()).unwrap().is_empty());
        assert!(b.sync(&prefs, &Choices::new()).unwrap().is_empty());
        let data=one(&mut b.conn(),"SELECT json_object('id',id,'path',path,'notes',notes,'avatar',avatar_path) AS value FROM projects");
        assert_eq!(data["path"], "C:/machine-a/project");
        assert_eq!(data["avatar"], "devicon:rust");
        let notes: Vec<Value> = serde_json::from_str(data["notes"].as_str().unwrap()).unwrap();
        assert_eq!(notes[0]["title"], "My title");
        b.execute("UPDATE projects SET path='D:/machine-b/project',description='changed on B'; UPDATE commands SET run_count=9;");
        b.sync(&prefs, &Choices::new()).unwrap();
        a.sync(&prefs, &Choices::new()).unwrap();
        b.sync(&prefs, &Choices::new()).unwrap();
        let ap=one(&mut a.conn(),"SELECT json_object('id',id,'path',path,'description',description) AS value FROM projects");
        let bp=one(&mut b.conn(),"SELECT json_object('id',id,'path',path,'description',description) AS value FROM projects");
        assert_eq!(ap["id"], 1);
        assert_eq!(ap["path"], "C:/machine-a/project");
        assert_eq!(bp["path"], "D:/machine-b/project");
        assert_eq!(ap["description"], "changed on B");
        assert_eq!(
            a.capture(&rid, &prefs).records,
            b.capture(&rid, &prefs).records
        );
        assert_eq!(
            one(
                &mut a.conn(),
                "SELECT json_object('count',count(*),'run_count',run_count) AS value FROM commands"
            )["run_count"],
            7
        );
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('count',count(*),'run_count',run_count) AS value FROM commands"
            )["count"],
            1
        );
        a.execute("DELETE FROM commands; DELETE FROM command_sections; DELETE FROM projects;");
        a.sync(&prefs, &Choices::new()).unwrap();
        b.sync(&prefs, &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('count',count(*)) AS value FROM projects"
            )["count"],
            0
        );
    }
    #[test]
    fn independent_offline_edits_merge_and_same_item_edits_conflict() {
        let (_dir, _rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("UPDATE projects SET description='A';");
        b.execute("UPDATE commands SET script='changed on B';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert!(b
            .sync(&Preferences::new(), &Choices::new())
            .unwrap()
            .is_empty());
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("UPDATE commands SET script='new A';");
        b.execute("UPDATE commands SET script='new B';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let conflicts = b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, "command");
        b.sync(
            &Preferences::new(),
            &Choices::from([(conflicts[0].id.clone(), "local".into())]),
        )
        .unwrap();
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut a.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "new B"
        );
    }
    #[test]
    fn deletion_vs_child_edit_conflicts_and_can_restore_project() {
        let (_dir, _rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("DELETE FROM projects;");
        b.execute("UPDATE commands SET script='offline edit';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let conflicts = b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, "project");
        b.sync(
            &Preferences::new(),
            &Choices::from([(conflicts[0].id.clone(), "local".into())]),
        )
        .unwrap();
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut a.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "offline edit"
        );
    }
    #[test]
    fn scope_baselines_preserve_excluded_data_and_catch_up_when_enabled() {
        let (_dir, _rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        let mut conn = b.conn();
        let mut c = config(&mut conn).unwrap();
        let key = c.active.clone().unwrap();
        c.profiles.get_mut(&key).unwrap().scopes.commands = false;
        kv_set(&mut conn, "config", &c).unwrap();
        drop(conn);
        a.execute("UPDATE commands SET script='remote changed';");
        b.execute("UPDATE projects SET description='B';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "npm run dev"
        );
        let mut conn = b.conn();
        let mut c = config(&mut conn).unwrap();
        c.profiles.get_mut(&key).unwrap().scopes.commands = true;
        kv_set(&mut conn, "config", &c).unwrap();
        drop(conn);
        assert!(b
            .sync(&Preferences::new(), &Choices::new())
            .unwrap()
            .is_empty());
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "remote changed"
        );
    }
    #[test]
    fn deleting_project_with_excluded_local_data_is_blocked() {
        let (_dir, _rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        let mut conn = b.conn();
        let mut c = config(&mut conn).unwrap();
        let key = c.active.clone().unwrap();
        c.profiles.get_mut(&key).unwrap().scopes.notes = false;
        kv_set(&mut conn, "config", &c).unwrap();
        drop(conn);
        a.execute("DELETE FROM projects;");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert!(b
            .sync(&Preferences::new(), &Choices::new())
            .unwrap_err()
            .to_lowercase()
            .contains("note"));
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('count',count(*)) AS value FROM projects"
            )["count"],
            1
        );
    }
    #[test]
    fn published_corruption_missing_parent_and_exclusive_lock_are_detected() {
        let (dir, _rid, a, _b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let p = active(&config(&mut a.conn()).unwrap()).unwrap().1;
        let repo = Repository::open(&p, false).unwrap();
        assert!(Repository::open(&p, false).is_err());
        let head = repo.head().unwrap().unwrap();
        let path = dir
            .0
            .join(DIRECTORY)
            .join("revisions")
            .join(format!("{}.json", head.id));
        let saved = fs::read(&path).unwrap();
        fs::write(&path, b"broken").unwrap();
        assert!(repo.head().is_err());
        fs::write(&path, saved).unwrap();
        let mut bad = head.clone();
        bad.id = Uuid::new_v4().to_string();
        bad.parent = Some("missing".into());
        bad.generation = 2;
        assert!(repo.publish(&bad, &BTreeMap::new()).is_err());
        let bytes = serde_json::to_vec(&Envelope {
            checksum: fingerprint(&bad).unwrap(),
            revision: bad.clone(),
        })
        .unwrap();
        fs::write(
            repo.root.join("revisions").join(format!("{}.json", bad.id)),
            bytes,
        )
        .unwrap();
        assert!(repo.head().unwrap_err().contains("missing"));
    }
    #[test]
    fn first_link_remaps_children_without_replacing_existing_numeric_ids() {
        let (dir, rid, a, b) = setup();
        seed(&a);
        seed(&b);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let local = b.capture(&rid, &Preferences::new());
        let repo = repository(&dir.0);
        let remote = repo.head().unwrap().unwrap().snapshot;
        let candidates = candidates(&local, &remote, &Snapshot::default());
        assert_eq!(candidates.len(), 1);
        let links = expand_links(
            &local,
            &remote,
            vec![SyncLink {
                local_id: candidates[0].local_id.clone(),
                remote_id: candidates[0].remote_id.clone(),
            }],
        )
        .unwrap();
        let linked = remap(&local, &links);
        assert_eq!(linked.records, remote.records);
        let profile = active(&config(&mut b.conn()).unwrap()).unwrap().1;
        apply(
            &mut b.conn(),
            &b.paths,
            &repo,
            &profile,
            &remote,
            &links,
            &BTreeSet::new(),
        )
        .unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('id',id,'count',count(*)) AS value FROM projects"
            )["id"],
            1
        );
        assert_eq!(b.capture(&rid, &Preferences::new()).records, remote.records);
    }
    #[test]
    fn separate_note_edits_merge_without_losing_titles() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.execute("UPDATE projects SET notes=json_insert(notes,'$[#]',json('{\"id\":\"second\",\"title\":\"Second title\",\"content\":\"second\",\"pinned\":false}')); ");
        a.execute("UPDATE projects SET notes=json_set(notes,'$[0].content','A changed body');");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert!(b
            .sync(&Preferences::new(), &Choices::new())
            .unwrap()
            .is_empty());
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let snap = a.capture(&rid, &Preferences::new());
        let notes: Vec<_> = snap.records.values().filter(|r| r.kind == "note").collect();
        assert_eq!(notes.len(), 2);
        assert!(notes.iter().any(|r| r.data["title"] == "Second title"));
        assert!(notes.iter().any(|r| r.data["content"] == "A changed body"));
    }
    #[test]
    fn running_command_deletion_rolls_back_and_does_not_advance_success() {
        let (dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("DELETE FROM commands;");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let repo = repository(&dir.0);
        let remote = repo.head().unwrap().unwrap().snapshot;
        let mut conn = b.conn();
        let profile = active(&config(&mut conn).unwrap()).unwrap().1;
        let result = conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
            apply(
                conn,
                &b.paths,
                &repo,
                &profile,
                &remote,
                &[],
                &BTreeSet::from([1]),
            )
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))
        });
        assert!(result.unwrap_err().to_string().contains("running"));
        assert!(b
            .capture(&rid, &Preferences::new())
            .records
            .values()
            .any(|r| r.kind == "command"));
        assert_eq!(
            status(&mut conn).unwrap().last_synced_at,
            profile.last_synced_at
        );
    }
    #[test]
    fn recovery_remerges_published_data_instead_of_overwriting_offline_edits() {
        let (dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("UPDATE projects SET description='from A';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let repo = repository(&dir.0);
        let revision = repo.head().unwrap().unwrap();
        drop(repo);
        let journal = Journal {
            profile_key: rid.clone(),
            revision,
            links: Vec::new(),
        };
        kv_set(&mut b.conn(), "journal", &journal).unwrap();
        b.execute("UPDATE commands SET script='edited after interrupted sync';");
        let mut conn = b.conn();
        let c = config(&mut conn).unwrap();
        recover(&mut conn, &b.paths, &c, &BTreeSet::new()).unwrap();
        drop(conn);
        assert!(b
            .sync(&Preferences::new(), &Choices::new())
            .unwrap()
            .is_empty());
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "edited after interrupted sync"
        );
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('description',description) AS value FROM projects"
            )["description"],
            "from A"
        );
    }
    #[test]
    fn invalid_repository_id_and_missing_drive_never_create_another_repository() {
        let (dir, _rid, a, _b) = setup();
        let mut p = active(&config(&mut a.conn()).unwrap()).unwrap().1;
        p.repository_id = Some(Uuid::new_v4().to_string());
        assert!(Repository::open(&p, true).is_err());
        p.folder = dir.0.join("missing-drive").to_string_lossy().into_owned();
        assert!(Repository::open(&p, true).is_err());
        assert!(!Path::new(&p.folder).exists());
    }
    #[test]
    fn image_assets_are_portable_verified_and_preference_delivery_is_durable() {
        let (dir, _rid, a, b) = setup();
        seed(&a);
        let image_path = a.paths.avatars_dir.join("original.png");
        image::RgbaImage::from_pixel(2, 2, image::Rgba([20, 40, 60, 255]))
            .save(&image_path)
            .unwrap();
        sql_query("UPDATE projects SET avatar_path=? WHERE id=1")
            .bind::<Text, _>(image_path.to_string_lossy().as_ref())
            .execute(&mut a.conn())
            .unwrap();
        let dark = Preferences::from([("theme".into(), "dark".into())]);
        let light = Preferences::from([("theme".into(), "light".into())]);
        a.sync(&dark, &Choices::new()).unwrap();
        let conflicts = b.sync(&light, &Choices::new()).unwrap();
        assert_eq!(conflicts.len(), 1);
        b.sync(
            &light,
            &Choices::from([(conflicts[0].id.clone(), "remote".into())]),
        )
        .unwrap();
        let path = one(
            &mut b.conn(),
            "SELECT json_object('avatar',avatar_path) AS value FROM projects",
        )["avatar"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(Path::new(&path).starts_with(&b.paths.avatars_dir));
        assert_eq!(fs::read(&path).unwrap(), fs::read(image_path).unwrap());
        assert_eq!(
            status(&mut b.conn())
                .unwrap()
                .pending_preferences
                .get("theme"),
            Some(&"dark".into())
        );
        let asset = fs::read_dir(dir.0.join(DIRECTORY).join("assets"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::write(&asset, b"damaged").unwrap();
        assert!(b
            .sync(&dark, &Choices::new())
            .unwrap_err()
            .contains("damaged"));
    }
    #[test]
    fn repository_rollback_is_rejected_and_relocation_keeps_its_identity() {
        let (dir, _rid, a, _b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let profile = active(&config(&mut a.conn()).unwrap()).unwrap().1;
        let repo = Repository::open(&profile, false).unwrap();
        let first = repo.head().unwrap().unwrap();
        drop(repo);
        a.execute("UPDATE projects SET description='new revision';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let profile = active(&config(&mut a.conn()).unwrap()).unwrap().1;
        let repo = Repository::open(&profile, false).unwrap();
        let latest = repo.head().unwrap().unwrap();
        drop(repo);
        let revision_path = dir
            .0
            .join(DIRECTORY)
            .join("revisions")
            .join(format!("{}.json", latest.id));
        let bytes = fs::read(&revision_path).unwrap();
        fs::remove_file(&revision_path).unwrap();
        assert!(Repository::open(&profile, false)
            .unwrap()
            .head()
            .unwrap_err()
            .contains("older"));
        fs::write(revision_path, bytes).unwrap();
        let relocated = TestDir::new();
        fs::rename(dir.0.join(DIRECTORY), relocated.0.join(DIRECTORY)).unwrap();
        let mut moved = profile;
        moved.folder = relocated.0.to_string_lossy().into_owned();
        let repo = Repository::open(&moved, false).unwrap();
        assert_eq!(repo.head().unwrap().unwrap().parent, Some(first.id));
    }
    #[test]
    fn command_deletion_conflicts_with_avatar_edit_and_can_keep_the_edit() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("DELETE FROM commands;");
        b.execute("UPDATE commands SET avatar_path='lucide:terminal';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let conflicts = b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, "command");
        b.sync(
            &Preferences::new(),
            &Choices::from([(conflicts[0].id.clone(), "local".into())]),
        )
        .unwrap();
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            a.capture(&rid, &Preferences::new()).records,
            b.capture(&rid, &Preferences::new()).records
        );
    }
    #[test]
    fn excluding_commands_still_allows_their_avatar_to_catch_up_later() {
        let (_dir, _rid, a, b) = setup();
        seed(&a);
        a.execute("UPDATE commands SET avatar_path='lucide:terminal';");
        let mut conn = a.conn();
        let mut c = config(&mut conn).unwrap();
        let key = c.active.clone().unwrap();
        c.profiles.get_mut(&key).unwrap().scopes.commands = false;
        kv_set(&mut conn, "config", &c).unwrap();
        drop(conn);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('count',count(*)) AS value FROM commands"
            )["count"],
            0
        );
        let mut conn = a.conn();
        let mut c = config(&mut conn).unwrap();
        c.profiles.get_mut(&key).unwrap().scopes.commands = true;
        kv_set(&mut conn, "config", &c).unwrap();
        drop(conn);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('avatar',avatar_path) AS value FROM commands"
            )["avatar"],
            "lucide:terminal"
        );
    }
    #[test]
    fn real_prepare_commit_rechecks_data_and_publishes_only_validated_results() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        let astate = a.state();
        let bstate = b.state();
        let sa = SyncService::default();
        let sb = SyncService::default();
        let p = prepare_sync(Preferences::new(), None, None, &astate, &sa).unwrap();
        assert!(p.conflicts.is_empty());
        assert!(p.links.is_empty());
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &astate,
            &sa,
        )
        .unwrap();
        let p = prepare_sync(Preferences::new(), None, None, &bstate, &sb).unwrap();
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &bstate,
            &sb,
        )
        .unwrap();
        let p = prepare_sync(Preferences::new(), None, None, &astate, &sa).unwrap();
        a.execute("UPDATE projects SET description='changed during review';");
        assert!(commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &astate,
            &sa
        )
        .unwrap_err()
        .contains("Local data changed"));
        sa.session.lock().unwrap().take();
        let p = prepare_sync(Preferences::new(), None, None, &astate, &sa).unwrap();
        b.execute("UPDATE commands SET script='remote changed during review';");
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert!(commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &astate,
            &sa
        )
        .unwrap_err()
        .contains("folder changed"));
        sa.session.lock().unwrap().take();
        let p = prepare_sync(Preferences::new(), None, None, &astate, &sa).unwrap();
        assert!(p.conflicts.is_empty());
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &astate,
            &sa,
        )
        .unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            a.capture(&rid, &Preferences::new()).records,
            b.capture(&rid, &Preferences::new()).records
        );
    }
    #[test]
    fn crash_between_publication_and_local_commit_can_be_retried_without_data_loss() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("UPDATE projects SET description='incoming';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let before = status(&mut b.conn()).unwrap().last_synced_at;
        let state = b.state();
        let service = SyncService::default();
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        service
            .fail_after_publish
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service
        )
        .unwrap_err()
        .contains("Simulated interruption"));
        assert_eq!(status(&mut b.conn()).unwrap().last_synced_at, before);
        assert!(kv_get::<Journal>(&mut b.conn(), "journal")
            .unwrap()
            .is_some());
        b.execute("UPDATE commands SET script='new local edit after crash';");
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        assert!(p.conflicts.is_empty());
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap();
        assert!(kv_get::<Journal>(&mut b.conn(), "journal")
            .unwrap()
            .is_none());
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('description',description) AS value FROM projects"
            )["description"],
            "incoming"
        );
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "new local edit after crash"
        );
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            a.capture(&rid, &Preferences::new()).records,
            b.capture(&rid, &Preferences::new()).records
        );
    }
    #[test]
    fn colliding_group_renames_report_how_to_recover_without_publishing() {
        let (dir, _rid, a, b) = setup();
        seed(&a);
        a.execute("INSERT INTO command_sections(project_id,name,order_index,created_at,updated_at) VALUES(1,'Alpha',1,'2026-01-01','2026-01-01'),(1,'Beta',2,'2026-01-01','2026-01-01');");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("UPDATE command_sections SET name='Shared' WHERE name='Alpha';");
        b.execute("UPDATE command_sections SET name='Shared' WHERE name='Beta';");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let before = repository(&dir.0).head().unwrap().unwrap().id;
        let last_success = status(&mut b.conn()).unwrap().last_synced_at;
        let state = b.state();
        let service = SyncService::default();
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        let error = commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap_err();
        assert!(error.contains("Rename one of these groups"), "{error}");
        assert_eq!(repository(&dir.0).head().unwrap().unwrap().id, before);
        assert_eq!(status(&mut b.conn()).unwrap().last_synced_at, last_success);
        b.execute("UPDATE command_sections SET name='Other' WHERE name='Shared';");
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('count',count(*)) AS value FROM command_sections"
            )["count"],
            3
        );
    }
    #[test]
    fn preferences_only_sync_does_not_review_or_track_excluded_project_data() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        seed(&b);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let state = b.state();
        let service = SyncService::default();
        configure_sync(
            None,
            SyncScopes {
                projects: false,
                commands: false,
                notes: false,
                avatars: false,
                preferences: true,
            },
            &state,
            &service,
        )
        .unwrap();
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        assert!(p.links.is_empty());
        assert!(p.conflicts.is_empty());
        b.execute("UPDATE commands SET script='excluded local edit';");
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap();
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "excluded local edit"
        );
        assert_eq!(
            one(
                &mut a.conn(),
                "SELECT json_object('script',script) AS value FROM commands"
            )["script"],
            "npm run dev"
        );
        assert!(active(&config(&mut b.conn()).unwrap())
            .unwrap()
            .1
            .baseline
            .records
            .values()
            .all(|r| r.kind == "preference"));
        assert_eq!(status(&mut b.conn()).unwrap().repository_id, Some(rid));
    }
    #[test]
    fn a_new_prepare_replaces_an_abandoned_preview_without_applying_it() {
        let (_dir, _rid, a, _b) = setup();
        seed(&a);
        let state = a.state();
        let service = SyncService::default();
        let old = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        let fresh = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        assert_ne!(old.session_id, fresh.session_id);
        assert!(commit_sync(
            old.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service
        )
        .unwrap_err()
        .contains("expired"));
        assert!(status(&mut a.conn()).unwrap().last_synced_at.is_none());
        commit_sync(
            fresh.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap();
    }
    #[test]
    fn independently_added_same_name_sections_can_be_resolved_without_duplicate_groups() {
        let (_dir, rid, a, b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        b.sync(&Preferences::new(), &Choices::new()).unwrap();
        a.execute("INSERT INTO command_sections(project_id,name,order_index,created_at,updated_at) VALUES(1,'Build',1,'2026-01-02','2026-01-02');");
        b.execute("INSERT INTO command_sections(project_id,name,order_index,created_at,updated_at) VALUES(1,'build',2,'2026-01-03','2026-01-03');");
        a.execute("INSERT INTO commands(project_id,name,script,section,created_at,updated_at) VALUES(1,'Build A','build-a','Build','2026-01-02','2026-01-02');");
        b.execute("INSERT INTO commands(project_id,name,script,section,created_at,updated_at) VALUES(1,'Build B','build-b','build','2026-01-03','2026-01-03');");
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let state = b.state();
        let service = SyncService::default();
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        assert_eq!(p.conflicts.len(), 1);
        assert_eq!(p.conflicts[0].kind, "section");
        let choices = Choices::from([(p.conflicts[0].id.clone(), "remote".into())]);
        commit_sync(p.session_id, choices, Preferences::new(), &state, &service).unwrap();
        assert_eq!(one(&mut b.conn(), "SELECT json_object('count',count(*),'id',id,'order',order_index) AS value FROM command_sections WHERE name='Build'")["count"], 1);
        // Retain B's numeric ID while adopting the shared sync identity.
        assert_eq!(
            one(
                &mut b.conn(),
                "SELECT json_object('id',id) AS value FROM command_sections WHERE name='Build'"
            )["id"],
            2
        );
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        assert_eq!(
            a.capture(&rid, &Preferences::new()).records,
            b.capture(&rid, &Preferences::new()).records
        );
    }
    #[test]
    fn recovery_allows_reselecting_the_same_repository_at_a_new_drive_location() {
        let (dir, rid, a, _b) = setup();
        seed(&a);
        a.sync(&Preferences::new(), &Choices::new()).unwrap();
        let repo = repository(&dir.0);
        let revision = repo.head().unwrap().unwrap();
        drop(repo);
        kv_set(
            &mut a.conn(),
            "journal",
            &Journal {
                profile_key: rid,
                revision,
                links: Vec::new(),
            },
        )
        .unwrap();
        let moved = TestDir::new();
        fs::rename(dir.0.join(DIRECTORY), moved.0.join(DIRECTORY)).unwrap();
        let state = a.state();
        let service = SyncService::default();
        configure_sync(
            Some(moved.0.to_string_lossy().into_owned()),
            SyncScopes::default(),
            &state,
            &service,
        )
        .unwrap();
        let p = prepare_sync(Preferences::new(), None, None, &state, &service).unwrap();
        commit_sync(
            p.session_id,
            Choices::new(),
            Preferences::new(),
            &state,
            &service,
        )
        .unwrap();
        assert!(kv_get::<Journal>(&mut a.conn(), "journal")
            .unwrap()
            .is_none());
    }
}
