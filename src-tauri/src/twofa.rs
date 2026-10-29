use std::collections::HashMap;
use std::io::Cursor;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use crate::AppState;

use argon2::{Algorithm as Argon2Algorithm, Argon2, Params as Argon2Params, Version as Argon2Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use chrono::Utc;
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{Binary, Integer, Text};
use diesel::SqliteConnection;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};
use ts_rs::TS;


// ============================================================================
// 1. Settings Enums & Types
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LockTimeSetting {
    Never,
    ThirtySeconds,
    OneMinute,
    FiveMinutes,
    TenMinutes,
    ThirtyMinutes,
    OneHour,
}

impl LockTimeSetting {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Never => "Never",
            Self::ThirtySeconds => "ThirtySeconds",
            Self::OneMinute => "OneMinute",
            Self::FiveMinutes => "FiveMinutes",
            Self::TenMinutes => "TenMinutes",
            Self::ThirtyMinutes => "ThirtyMinutes",
            Self::OneHour => "OneHour",
        }
    }

    pub fn as_secs(&self) -> Option<u64> {
        match self {
            Self::Never => None,
            Self::ThirtySeconds => Some(30),
            Self::OneMinute => Some(60),
            Self::FiveMinutes => Some(300),
            Self::TenMinutes => Some(600),
            Self::ThirtyMinutes => Some(1800),
            Self::OneHour => Some(3600),
        }
    }

    pub fn from_legacy_or_str(s: &str) -> Self {
        match s {
            "Never" | "0" => Self::Never,
            "ThirtySeconds" | "30s" | "30" => Self::ThirtySeconds,
            "OneMinute" | "1m" | "1" => Self::OneMinute,
            "FiveMinutes" | "5m" | "5" => Self::FiveMinutes,
            "TenMinutes" | "10m" | "10" => Self::TenMinutes,
            "ThirtyMinutes" | "30m" => Self::ThirtyMinutes,
            "OneHour" | "1h" | "60" => Self::OneHour,
            _ => Self::FiveMinutes, // Unknown / e.g. "15" -> default FiveMinutes
        }
    }
}

impl Default for LockTimeSetting {
    fn default() -> Self {
        Self::FiveMinutes
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum HideTokenSetting {
    Never,
    ShowAfterClick,
    Always,
}

impl HideTokenSetting {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Never => "Never",
            Self::ShowAfterClick => "ShowAfterClick",
            Self::Always => "Always",
        }
    }

    pub fn from_legacy_or_str(s: &str) -> Self {
        match s {
            "Never" => Self::Never,
            "ShowAfterClick" => Self::ShowAfterClick,
            "Always" => Self::Always,
            _ => Self::Never,
        }
    }
}

impl Default for HideTokenSetting {
    fn default() -> Self {
        Self::Never
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ClearClipboardSetting {
    Disabled,
    TenSeconds,
    TwentySeconds,
    ThirtySeconds,
    OneMinute,
}

impl ClearClipboardSetting {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "Disabled",
            Self::TenSeconds => "TenSeconds",
            Self::TwentySeconds => "TwentySeconds",
            Self::ThirtySeconds => "ThirtySeconds",
            Self::OneMinute => "OneMinute",
        }
    }

    pub fn as_secs(&self) -> Option<u64> {
        match self {
            Self::Disabled => None,
            Self::TenSeconds => Some(10),
            Self::TwentySeconds => Some(20),
            Self::ThirtySeconds => Some(30),
            Self::OneMinute => Some(60),
        }
    }

    pub fn from_legacy_or_str(s: &str) -> Self {
        match s {
            "Disabled" | "0" | "Never" => Self::Disabled,
            "TenSeconds" | "10s" | "10" => Self::TenSeconds,
            "TwentySeconds" | "20s" | "20" => Self::TwentySeconds,
            "ThirtySeconds" | "30s" | "30" => Self::ThirtySeconds,
            "OneMinute" | "60s" | "60" => Self::OneMinute,
            _ => Self::ThirtySeconds,
        }
    }
}

impl Default for ClearClipboardSetting {
    fn default() -> Self {
        Self::ThirtySeconds
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SortOrderSetting {
    #[serde(rename = "ISSUER_ASC")]
    IssuerAsc,
    #[serde(rename = "ISSUER_DESC")]
    IssuerDesc,
    #[serde(rename = "CREATED_ASC")]
    CreatedAsc,
    #[serde(rename = "CREATED_DESC")]
    CreatedDesc,
}

impl SortOrderSetting {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::IssuerAsc => "ISSUER_ASC",
            Self::IssuerDesc => "ISSUER_DESC",
            Self::CreatedAsc => "CREATED_ASC",
            Self::CreatedDesc => "CREATED_DESC",
        }
    }

    pub fn from_legacy_or_str(s: &str) -> Self {
        match s {
            "ISSUER_ASC" | "Alphabetical" | "issuer" => Self::IssuerAsc,
            "ISSUER_DESC" => Self::IssuerDesc,
            "CREATED_ASC" | "oldest" => Self::CreatedAsc,
            "CREATED_DESC" | "newest" => Self::CreatedDesc,
            _ => Self::IssuerAsc,
        }
    }
}

impl Default for SortOrderSetting {
    fn default() -> Self {
        Self::IssuerAsc
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaVaultSettings {
    pub lock_time_setting: LockTimeSetting,
    pub lock_on_screen_lock: bool,
    pub hide_token_setting: HideTokenSetting,
    pub clear_clipboard_setting: ClearClipboardSetting,
    pub sort_order_setting: SortOrderSetting,
}

impl Default for TwofaVaultSettings {
    fn default() -> Self {
        Self {
            lock_time_setting: LockTimeSetting::default(),
            lock_on_screen_lock: true,
            hide_token_setting: HideTokenSetting::default(),
            clear_clipboard_setting: ClearClipboardSetting::default(),
            sort_order_setting: SortOrderSetting::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum CredentialStoreStatus {
    Untested,
    Available,
    MissingCredential,
    LockedOrDenied,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialStoreError {
    NotFound,
    LockedOrDenied(String),
    Unavailable(String),
    Other(String),
}

impl std::fmt::Display for CredentialStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "Credential not found"),
            Self::LockedOrDenied(msg) => write!(f, "Credential store locked or access denied: {}", msg),
            Self::Unavailable(msg) => write!(f, "Credential store unavailable: {}", msg),
            Self::Other(msg) => write!(f, "Credential store error: {}", msg),
        }
    }
}

impl std::error::Error for CredentialStoreError {}

pub trait CredentialStore: Send + Sync {
    fn get_password(&self, service: &str, user: &str) -> Result<String, CredentialStoreError>;
    fn set_password(&self, service: &str, user: &str, password: &str) -> Result<(), CredentialStoreError>;
    fn delete_password(&self, service: &str, user: &str) -> Result<(), CredentialStoreError>;
}

pub struct OsCredentialStore;

impl CredentialStore for OsCredentialStore {
    fn get_password(&self, service: &str, user: &str) -> Result<String, CredentialStoreError> {
        let entry = keyring::v1::Entry::new(service, user).map_err(map_keyring_error)?;
        entry.get_password().map_err(map_keyring_error)
    }

    fn set_password(&self, service: &str, user: &str, password: &str) -> Result<(), CredentialStoreError> {
        let entry = keyring::v1::Entry::new(service, user).map_err(map_keyring_error)?;
        entry.set_password(password).map_err(map_keyring_error)
    }

    fn delete_password(&self, service: &str, user: &str) -> Result<(), CredentialStoreError> {
        let entry = keyring::v1::Entry::new(service, user).map_err(map_keyring_error)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_keyring_error(e)),
        }
    }
}

fn map_keyring_error(err: keyring::Error) -> CredentialStoreError {
    match err {
        keyring::Error::NoEntry => CredentialStoreError::NotFound,
        keyring::Error::Ambiguous(_) => CredentialStoreError::Other("Ambiguous entry".to_string()),
        keyring::Error::PlatformFailure(ref e) => {
            let msg = format!("{:?}", e);
            if msg.to_lowercase().contains("denied") || msg.to_lowercase().contains("locked") {
                CredentialStoreError::LockedOrDenied(msg)
            } else {
                CredentialStoreError::Unavailable(msg)
            }
        }
        other => CredentialStoreError::Other(format!("{}", other)),
    }
}

#[derive(Default)]
pub struct MockCredentialStore {
    pub entries: std::sync::Mutex<HashMap<(String, String), String>>,
    pub fail_on_get: std::sync::atomic::AtomicBool,
    pub fail_on_set: std::sync::atomic::AtomicBool,
    pub fail_on_delete: std::sync::atomic::AtomicBool,
    pub simulate_locked: std::sync::atomic::AtomicBool,
    pub simulate_unavailable: std::sync::atomic::AtomicBool,
}

impl CredentialStore for MockCredentialStore {
    fn get_password(&self, service: &str, user: &str) -> Result<String, CredentialStoreError> {
        if self.simulate_unavailable.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Unavailable("Mock store unavailable".to_string()));
        }
        if self.simulate_locked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::LockedOrDenied("Mock store locked".to_string()));
        }
        if self.fail_on_get.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Other("Injected get failure".to_string()));
        }
        let lock = self.entries.lock().map_err(|e| CredentialStoreError::Other(e.to_string()))?;
        lock.get(&(service.to_string(), user.to_string()))
            .cloned()
            .ok_or(CredentialStoreError::NotFound)
    }

    fn set_password(&self, service: &str, user: &str, password: &str) -> Result<(), CredentialStoreError> {
        if self.simulate_unavailable.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Unavailable("Mock store unavailable".to_string()));
        }
        if self.simulate_locked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::LockedOrDenied("Mock store locked".to_string()));
        }
        if self.fail_on_set.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Other("Injected set failure".to_string()));
        }
        let mut lock = self.entries.lock().map_err(|e| CredentialStoreError::Other(e.to_string()))?;
        lock.insert((service.to_string(), user.to_string()), password.to_string());
        Ok(())
    }

    fn delete_password(&self, service: &str, user: &str) -> Result<(), CredentialStoreError> {
        if self.simulate_unavailable.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Unavailable("Mock store unavailable".to_string()));
        }
        if self.simulate_locked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::LockedOrDenied("Mock store locked".to_string()));
        }
        if self.fail_on_delete.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialStoreError::Other("Injected delete failure".to_string()));
        }
        let mut lock = self.entries.lock().map_err(|e| CredentialStoreError::Other(e.to_string()))?;
        lock.remove(&(service.to_string(), user.to_string()));
        Ok(())
    }
}

pub fn is_valid_vault_credential_id(vault_uuid: &str, cred_id: &str) -> bool {
    let prefix_auto = format!("{}:auto:gen-", vault_uuid);
    let prefix_pin = format!("{}:pin:gen-", vault_uuid);
    if let Some(suffix) = cred_id.strip_prefix(&prefix_auto) {
        suffix.parse::<u32>().is_ok()
    } else if let Some(suffix) = cred_id.strip_prefix(&prefix_pin) {
        suffix.parse::<u32>().is_ok()
    } else {
        false
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaPlatformCapabilities {
    pub can_detect_os_idle: bool,
    pub can_detect_screen_lock: bool,
    pub is_conservative_mode: bool,
    pub idle_detection_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaVaultStatus {
    pub is_initialized: bool,
    pub is_locked: bool,
    pub has_vault: bool,
    pub is_unlocked: bool,
    pub session_id: Option<String>,
    #[ts(type = "number")]
    pub revision: u64,
    pub lock_enabled: bool,
    pub pin_enabled: bool,
    #[ts(type = "number")]
    pub pin_failed_attempts: u32,
    #[ts(type = "number")]
    pub pin_max_attempts: u32,
    pub is_pin_blocked: bool,
    pub recovery_required: bool,
    pub setup_cleanup_required: bool,
    pub credential_store_status: CredentialStoreStatus,
    pub lock_time_setting: LockTimeSetting,
    pub lock_on_screen_lock: bool,
    pub hide_token_setting: HideTokenSetting,
    pub clear_clipboard_setting: ClearClipboardSetting,
    pub sort_order_setting: SortOrderSetting,
    pub account_count: usize,
    pub unassigned_count: usize,
    pub platform_capabilities: TwofaPlatformCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaSecurityError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl TwofaSecurityError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(code: impl Into<String>, message: impl Into<String>, details: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details.into()),
        }
    }
}

impl std::fmt::Display for TwofaSecurityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(ref d) = self.details {
            write!(f, "{}: {} ({})", self.code, self.message, d)
        } else {
            write!(f, "{}: {}", self.code, self.message)
        }
    }
}

impl std::error::Error for TwofaSecurityError {}

impl From<String> for TwofaSecurityError {
    fn from(s: String) -> Self {
        if let Some((code, msg)) = s.split_once(": ") {
            Self::new(code, msg)
        } else {
            Self::new("UNKNOWN", s)
        }
    }
}

impl From<&str> for TwofaSecurityError {
    fn from(s: &str) -> Self {
        s.to_string().into()
    }
}

impl From<diesel::result::Error> for TwofaSecurityError {
    fn from(e: diesel::result::Error) -> Self {
        Self::new("STORAGE_ERROR", format!("Database error: {}", e))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityTransitionJournal {
    pub version: u32,
    pub vault_uuid: String,
    pub op_id: String,
    pub op_type: String,
    pub source_generation: i32,
    pub target_generation: i32,
    pub old_credential_ids: Vec<String>,
    pub new_credential_ids: Vec<String>,
    pub stage: String,
}

impl SecurityTransitionJournal {
    pub fn new(
        vault_uuid: String,
        op_type: String,
        source_generation: i32,
        target_generation: i32,
        old_credential_ids: Vec<String>,
        new_credential_ids: Vec<String>,
    ) -> Self {
        Self {
            version: 1,
            vault_uuid,
            op_id: Uuid::new_v4().to_string(),
            op_type,
            source_generation,
            target_generation,
            old_credential_ids,
            new_credential_ids,
            stage: "Initiated".to_string(),
        }
    }

    pub fn validate(&self, expected_uuid: &str) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("Unsupported transition journal version: {}", self.version));
        }
        if self.vault_uuid != expected_uuid {
            return Err(format!("Journal vault_uuid mismatch: expected {}, got {}", expected_uuid, self.vault_uuid));
        }
        for id in self.old_credential_ids.iter().chain(self.new_credential_ids.iter()) {
            if !is_valid_vault_credential_id(expected_uuid, id) {
                return Err(format!("Invalid credential ID in transition journal: {}", id));
            }
        }
        Ok(())
    }
}


// ============================================================================
// 2. Data Models (Secrets, Accounts, Codes, Previews)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaAccountSecretPayload {
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub notes: String,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaAccountSummary {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub notes: String,
    pub icon: Option<String>,
    #[ts(type = "number[]")]
    pub project_ids: Vec<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub is_valid: bool,
    pub validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaAccountInput {
    pub issuer: String,
    pub account: String,
    pub secret: Option<String>,
    pub algorithm: Option<String>,
    pub digits: Option<u32>,
    pub period: Option<u32>,
    pub notes: Option<String>,
    pub icon: Option<String>,
    #[ts(type = "number[] | null")]
    pub project_ids: Option<Vec<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaCodeItem {
    pub account_id: String,
    pub code: String,
    pub period: u32,
    #[ts(type = "number")]
    pub valid_until: u64,
    pub remaining_seconds: u32,
    pub is_valid: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaCodeBatch {
    #[ts(type = "number")]
    pub server_time: u64,
    pub codes: Vec<TwofaCodeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaCopyResult {
    pub success: bool,
    pub remaining_seconds: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ImportAction {
    Skip,
    Link,
    Create,
}

impl Default for ImportAction {
    fn default() -> Self {
        Self::Create
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaImportPreviewItem {
    pub temp_id: String,
    pub issuer: String,
    pub account: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub notes: String,
    pub icon: Option<String>,
    pub suggested_project_names: Vec<String>,
    pub is_duplicate: bool,
    pub existing_account_id: Option<String>,
    pub existing_issuer: Option<String>,
    pub existing_account: Option<String>,
    pub is_valid: bool,
    pub validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaImportPreview {
    pub preview_id: String,
    pub items: Vec<TwofaImportPreviewItem>,
    pub partial_warning: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TwofaPendingImportItem {
    pub temp_id: String,
    pub payload: TwofaAccountSecretPayload,
    pub suggested_project_names: Vec<String>,
    pub is_duplicate: bool,
    pub existing_account_id: Option<String>,
    pub existing_issuer: Option<String>,
    pub existing_account: Option<String>,
    pub is_valid: bool,
    pub validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommitImportItemSelection {
    pub temp_id: String,
    pub selected: bool,
    pub action: ImportAction,
    pub issuer: String,
    pub account: String,
    pub secret: Option<String>,
    pub algorithm: Option<String>,
    pub digits: Option<u32>,
    pub period: Option<u32>,
    #[ts(type = "number[]")]
    pub project_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaImportCommitResult {
    pub created_count: usize,
    pub linked_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectDelete2faPreview {
    pub exclusive_accounts_count: usize,
    pub shared_accounts_count: usize,
    pub is_vault_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaVaultStateChangedEvent {
    pub session_id: Option<String>,
    pub is_unlocked: bool,
    #[ts(type = "number")]
    pub revision: u64,
    pub reason: String,
}



// ============================================================================
// 3. Platform Idle & Screen Lock Adapters
// ============================================================================

pub fn detect_platform_capabilities() -> TwofaPlatformCapabilities {
    #[cfg(target_os = "windows")]
    {
        TwofaPlatformCapabilities {
            can_detect_os_idle: true,
            can_detect_screen_lock: true,
            is_conservative_mode: false,
            idle_detection_note: None,
        }
    }
    #[cfg(target_os = "macos")]
    {
        TwofaPlatformCapabilities {
            can_detect_os_idle: true,
            can_detect_screen_lock: false,
            is_conservative_mode: false,
            idle_detection_note: None,
        }
    }
    #[cfg(target_os = "linux")]
    {
        let can_idle = get_os_idle_time().is_ok();
        if can_idle {
            TwofaPlatformCapabilities {
                can_detect_os_idle: true,
                can_detect_screen_lock: false,
                is_conservative_mode: false,
                idle_detection_note: None,
            }
        } else {
            TwofaPlatformCapabilities {
                can_detect_os_idle: false,
                can_detect_screen_lock: false,
                is_conservative_mode: true,
                idle_detection_note: Some("Linux environment lacks OS idle signal: Vault will lock immediately when the window loses focus (conservative mode).".to_string()),
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        TwofaPlatformCapabilities {
            can_detect_os_idle: false,
            can_detect_screen_lock: false,
            is_conservative_mode: true,
            idle_detection_note: Some("Platform does not support OS idle detection.".to_string()),
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn get_os_idle_time() -> Result<Duration, String> {
    match user_idle::UserIdle::get_time() {
        Ok(idle) => Ok(idle.duration()),
        Err(e) => Err(format!("Failed to get user idle: {:?}", e)),
    }
}

// Use a checked Rust X11 connection: user-idle 0.6 dereferences a null display
// when no X server is available (headless CI, native Wayland, or a lost session).
#[cfg(target_os = "linux")]
fn get_linux_idle_time(display: Option<&str>) -> Result<Duration, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::screensaver::ConnectionExt;

    let (connection, screen_index) = x11rb::connect(display)
        .map_err(|error| format!("Cannot connect to X11 for idle detection: {error}"))?;
    let screen = connection.setup().roots.get(screen_index)
        .ok_or_else(|| "X11 screen is unavailable".to_string())?;
    let reply = connection.screensaver_query_info(screen.root)
        .map_err(|error| format!("Cannot query X11 idle time: {error}"))?
        .reply()
        .map_err(|error| format!("Cannot read X11 idle time: {error}"))?;
    Ok(Duration::from_millis(u64::from(reply.ms_since_user_input)))
}

#[cfg(target_os = "linux")]
pub fn get_os_idle_time() -> Result<Duration, String> {
    get_linux_idle_time(None)
}

#[cfg(all(test, target_os = "linux"))]
mod linux_idle_tests {
    #[test]
    fn invalid_x11_display_returns_error_without_crashing() {
        assert!(super::get_linux_idle_time(Some("invalid-display")).is_err());
    }

    #[test]
    fn headless_vault_uses_conservative_locking() {
        if std::env::var_os("DISPLAY").is_none() {
            let state = super::TwofaVaultState::new();
            assert!(!state.platform_capabilities.can_detect_os_idle);
            assert!(state.platform_capabilities.is_conservative_mode);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn is_screen_locked() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn OpenInputDesktop(dwFlags: u32, fInherit: i32, dwDesiredAccess: u32) -> isize;
        fn CloseDesktop(hDesktop: isize) -> i32;
    }
    unsafe {
        let desktop = OpenInputDesktop(0, 0, 0x0100 /* DESKTOP_SWITCHDESKTOP */);
        if desktop == 0 {
            true
        } else {
            CloseDesktop(desktop);
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_screen_locked() -> bool {
    false
}

// ============================================================================
// 4. In-Memory Vault State & Auto-Lock Logic
// ============================================================================

pub struct TwofaVaultState {
    pub session_id: Option<String>,
    pub revision: u64,
    pub master_data_key: Option<Zeroizing<[u8; 32]>>,
    pub last_activity: Instant,
    pub last_focus_lost: Option<Instant>,
    pub exempt_focus_lock_until: Option<Instant>,
    pub last_tick_instant: Instant,
    pub settings: TwofaVaultSettings,
    pub import_previews: HashMap<String, (Instant, Vec<TwofaPendingImportItem>)>,
    pub last_copied_code: Option<String>,
    pub platform_capabilities: TwofaPlatformCapabilities,
    pub lock_enabled: bool,
    pub credential_store_status: CredentialStoreStatus,
    pub last_auth_operation_id: Option<String>,
}

impl TwofaVaultState {
    pub fn new() -> Self {
        Self {
            session_id: None,
            revision: 1,
            master_data_key: None,
            last_activity: Instant::now(),
            last_focus_lost: None,
            exempt_focus_lock_until: None,
            last_tick_instant: Instant::now(),
            settings: TwofaVaultSettings::default(),
            import_previews: HashMap::new(),
            last_copied_code: None,
            platform_capabilities: detect_platform_capabilities(),
            lock_enabled: true,
            credential_store_status: CredentialStoreStatus::Untested,
            last_auth_operation_id: None,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.master_data_key.is_some()
    }

    pub fn unlock(&mut self, data_key: [u8; 32], settings: TwofaVaultSettings, lock_enabled: bool) {
        self.master_data_key = Some(Zeroizing::new(data_key));
        self.session_id = Some(Uuid::new_v4().to_string());
        self.revision += 1;
        self.last_activity = Instant::now();
        self.last_focus_lost = None;
        self.exempt_focus_lock_until = None;
        self.last_tick_instant = Instant::now();
        self.settings = settings;
        self.lock_enabled = lock_enabled;
        self.import_previews.clear();
    }

    pub fn lock(&mut self) {
        if let Some(mut key) = self.master_data_key.take() {
            key.zeroize();
        }
        self.session_id = None;
        self.revision += 1;
        self.import_previews.clear();
        self.last_focus_lost = None;
        self.exempt_focus_lock_until = None;
        self.last_activity = Instant::now();
        self.last_auth_operation_id = None;
    }

    pub fn touch_activity(&mut self) {
        self.last_activity = Instant::now();
    }

    pub fn handle_focus_change(&mut self, focused: bool) {
        if !self.lock_enabled {
            return;
        }
        if focused {
            // Regaining focus clears the lost-focus duration counter, but DOES NOT reset OS idle counter!
            self.last_focus_lost = None;
        } else if self.last_focus_lost.is_none() {
            self.last_focus_lost = Some(Instant::now());
        }
    }

    pub fn exempt_focus_lock(&mut self, duration: Duration) {
        self.exempt_focus_lock_until = Some(Instant::now() + duration);
    }

    pub fn is_focus_lock_exempt(&self) -> bool {
        self.exempt_focus_lock_until.map_or(false, |until| Instant::now() < until)
    }

    pub fn validate_session(&self, expected_session_id: &str) -> Result<(), String> {
        if !self.is_unlocked() {
            return Err("2FA Vault is locked".to_string());
        }
        match &self.session_id {
            Some(sid) if sid == expected_session_id => Ok(()),
            _ => Err("Vault session has expired or changed. Please re-authenticate.".to_string()),
        }
    }

    pub fn validate_session_and_revision(
        &self,
        expected_session_id: &str,
        expected_revision: u64,
    ) -> Result<(), String> {
        self.validate_session(expected_session_id)?;
        if self.revision != expected_revision {
            return Err("STALE_REVISION: Vault configuration was updated in another window/action. Please refresh.".to_string());
        }
        Ok(())
    }

    /// Pure auto-lock evaluation without mutating lock state
    pub fn evaluate_auto_lock_reason(
        &mut self,
        now: Instant,
        os_idle: Option<Duration>,
        screen_locked: bool,
    ) -> Option<&'static str> {
        if !self.is_unlocked() {
            return None;
        }

        // When lock_enabled is false, bypass all auto-lock triggers (timeout, screen lock, sleep, Linux focus loss)
        if !self.lock_enabled {
            return None;
        }

        // 1. Detect sleep/suspend via monotonic clock jump (interval is 1s, jump >= 5s means system slept)
        let tick_elapsed = now.saturating_duration_since(self.last_tick_instant);
        self.last_tick_instant = now;
        if tick_elapsed >= Duration::from_secs(5) {
            return Some("auto_lock_sleep");
        }

        // 2. Lock on screen lock if setting is enabled
        if self.settings.lock_on_screen_lock && screen_locked {
            return Some("auto_lock_screen_lock");
        }

        // 3. Conservative Linux mode without reliable OS idle
        if self.platform_capabilities.is_conservative_mode {
            if self.last_focus_lost.is_some() && !self.is_focus_lock_exempt() {
                return Some("conservative_focus_lost");
            }
            if let Some(timeout_secs) = self.settings.lock_time_setting.as_secs() {
                if now.saturating_duration_since(self.last_activity).as_secs() >= timeout_secs {
                    return Some("conservative_inactivity");
                }
            }
            return None;
        }

        // 4. Standard mode: OS idle OR continuous window focus lost
        if let Some(timeout_secs) = self.settings.lock_time_setting.as_secs() {
            if let Some(idle) = os_idle {
                if idle.as_secs() >= timeout_secs {
                    return Some("auto_lock_idle");
                }
            }
            if let Some(lost) = self.last_focus_lost {
                if now.saturating_duration_since(lost).as_secs() >= timeout_secs {
                    return Some("auto_lock_focus_lost");
                }
            }
        }

        None
    }

    pub fn check_auto_lock_reason_with_time(
        &mut self,
        now: Instant,
        os_idle: Option<Duration>,
        screen_locked: bool,
    ) -> Option<&'static str> {
        let reason = self.evaluate_auto_lock_reason(now, os_idle, screen_locked);
        if reason.is_some() {
            self.lock();
        }
        reason
    }

    pub fn check_auto_lock_with_time(
        &mut self,
        now: Instant,
        os_idle: Option<Duration>,
        screen_locked: bool,
    ) -> bool {
        self.check_auto_lock_reason_with_time(now, os_idle, screen_locked).is_some()
    }

    pub fn evaluate_auto_lock(&mut self) -> Option<&'static str> {
        let now = Instant::now();
        let os_idle = get_os_idle_time().ok();
        let screen_locked = is_screen_locked();
        self.evaluate_auto_lock_reason(now, os_idle, screen_locked)
    }

    pub fn check_auto_lock(&mut self) -> bool {
        let now = Instant::now();
        let os_idle = get_os_idle_time().ok();
        let screen_locked = is_screen_locked();
        self.check_auto_lock_with_time(now, os_idle, screen_locked)
    }

    pub fn clear_clipboard_if_matches(&mut self, app: &AppHandle) {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        if let Some(target_code) = self.last_copied_code.take() {
            if let Ok(current) = app.clipboard().read_text() {
                if current == target_code {
                    let _ = app.clipboard().clear();
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum VaultSignal {
    FocusChanged(bool),
    WindowMinimized,
    UserActivity,
    ScreenLocked,
    SleepWake,
}

#[derive(Debug, Clone)]
pub struct OperationToken {
    pub token: String,
    pub session_id: String,
    pub expires_at: Instant,
}

#[derive(Debug)]
pub struct SecurityOpGuard<'a> {
    in_flight: &'a std::sync::atomic::AtomicBool,
}

impl<'a> Drop for SecurityOpGuard<'a> {
    fn drop(&mut self) {
        self.in_flight.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

pub struct VaultService {
    pub state: std::sync::Mutex<TwofaVaultState>,
    pub signals_tx: std::sync::mpsc::Sender<VaultSignal>,
    signals_rx: std::sync::Mutex<std::sync::mpsc::Receiver<VaultSignal>>,
    pub clipboard_generation: std::sync::atomic::AtomicU64,
    pub auth_epoch: std::sync::atomic::AtomicU64,
    pub security_op_in_flight: std::sync::atomic::AtomicBool,
    pub operation_tokens: std::sync::Mutex<HashMap<String, OperationToken>>,
    pub credential_store: Arc<dyn CredentialStore>,
    pub pin_verification_lock: std::sync::Mutex<()>,
    pub cancelled_auth_ops: std::sync::Mutex<HashMap<String, Instant>>,
}

impl VaultService {
    pub fn new() -> Self {
        Self::new_with_store(Arc::new(OsCredentialStore))
    }

    pub fn new_with_store(store: Arc<dyn CredentialStore>) -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        Self {
            state: std::sync::Mutex::new(TwofaVaultState::new()),
            signals_tx: tx,
            signals_rx: std::sync::Mutex::new(rx),
            clipboard_generation: std::sync::atomic::AtomicU64::new(0),
            auth_epoch: std::sync::atomic::AtomicU64::new(1),
            security_op_in_flight: std::sync::atomic::AtomicBool::new(false),
            operation_tokens: std::sync::Mutex::new(HashMap::new()),
            credential_store: store,
            pin_verification_lock: std::sync::Mutex::new(()),
            cancelled_auth_ops: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn cancel_auth_op(&self, operation_id: &str) {
        if let Ok(mut map) = self.cancelled_auth_ops.lock() {
            let now = Instant::now();
            map.retain(|_, exp| now < *exp);
            map.insert(operation_id.to_string(), now + Duration::from_secs(60));
        }
    }

    pub fn is_auth_cancelled(&self, operation_id: &str) -> bool {
        if let Ok(mut map) = self.cancelled_auth_ops.lock() {
            let now = Instant::now();
            map.retain(|_, exp| now < *exp);
            map.contains_key(operation_id)
        } else {
            false
        }
    }

    pub fn acquire_security_op(&self) -> Result<SecurityOpGuard<'_>, String> {
        if self
            .security_op_in_flight
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_err()
        {
            return Err("BUSY: Another security operation is currently in progress. Please retry.".to_string());
        }
        Ok(SecurityOpGuard {
            in_flight: &self.security_op_in_flight,
        })
    }

    pub fn bump_auth_epoch(&self) -> u64 {
        self.auth_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }

    pub fn current_auth_epoch(&self) -> u64 {
        self.auth_epoch.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn cancel_all_operations(&self) {
        if let Ok(mut tokens) = self.operation_tokens.lock() {
            tokens.clear();
        }
    }


    pub fn lock(&self) -> std::sync::LockResult<std::sync::MutexGuard<'_, TwofaVaultState>> {
        self.state.lock()
    }

    pub fn evaluate_auto_lock_reason(&self) -> Option<&'static str> {
        let mut vault = self.state.lock().ok()?;
        vault.evaluate_auto_lock()
    }

    pub fn send_signal(&self, signal: VaultSignal) {
        let _ = self.signals_tx.send(signal);
    }

    pub fn begin_operation(&self, expected_session_id: &str, duration: Duration) -> Result<String, String> {
        let max_duration = duration.min(Duration::from_secs(30));
        let mut vault = self.state.lock().map_err(|e| e.to_string())?;
        vault.validate_session(expected_session_id)?;
        vault.exempt_focus_lock(max_duration);
        let session_id = vault.session_id.clone().ok_or_else(|| "Vault is locked".to_string())?;
        let token = Uuid::new_v4().to_string();
        let expires_at = Instant::now() + max_duration;
        let mut tokens = self.operation_tokens.lock().map_err(|e| e.to_string())?;
        tokens.insert(token.clone(), OperationToken {
            token: token.clone(),
            session_id,
            expires_at,
        });
        Ok(token)
    }

    pub fn verify_operation(&self, token_str: &str) -> Result<(), String> {
        let token = {
            let mut tokens = self.operation_tokens.lock().map_err(|e| e.to_string())?;
            tokens.remove(token_str).ok_or_else(|| "Invalid or expired operation token".to_string())?
        };

        if Instant::now() > token.expires_at {
            return Err("Operation token expired".to_string());
        }

        let vault = self.state.lock().map_err(|e| e.to_string())?;
        if !vault.is_unlocked() {
            return Err("Vault was locked while operation was pending".to_string());
        }
        if vault.session_id.as_deref() != Some(&token.session_id) {
            return Err("Vault session changed while operation was pending".to_string());
        }

        Ok(())
    }

    pub fn lock_with_reason(&self, app: &AppHandle, reason: &str) {
        self.auth_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.clipboard_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let revision = {
            let mut vault = match self.state.lock() {
                Ok(v) => v,
                Err(p) => p.into_inner(),
            };
            vault.lock();
            vault.clear_clipboard_if_matches(app);
            vault.revision
        };

        if let Ok(mut tokens) = self.operation_tokens.lock() {
            tokens.clear();
        }

        let _ = app.emit("twofa:vault-state-changed", TwofaVaultStateChangedEvent {
            session_id: None,
            is_unlocked: false,
            revision,
            reason: reason.to_string(),
        });
    }

    pub fn clear_clipboard_if_generation_matches(&self, app: &AppHandle, target_gen: u64, target_code: &str) {
        if self.clipboard_generation.load(std::sync::atomic::Ordering::SeqCst) == target_gen {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            if let Ok(current) = app.clipboard().read_text() {
                if current == target_code {
                    let _ = app.clipboard().clear();
                    if let Ok(mut vault) = self.state.lock() {
                        vault.last_copied_code = None;
                    }
                }
            }
        }
    }

    pub fn clear_clipboard_if_matches(&self, app: &AppHandle) {
        if let Ok(mut vault) = self.state.lock() {
            vault.clear_clipboard_if_matches(app);
        }
    }

    pub fn process_signals_and_auto_lock(&self, app: &AppHandle) {
        let mut signals = Vec::new();
        if let Ok(rx) = self.signals_rx.lock() {
            while let Ok(sig) = rx.try_recv() {
                signals.push(sig);
            }
        }

        let mut lock_reason: Option<&'static str> = None;

        {
            let mut vault = match self.state.lock() {
                Ok(v) => v,
                Err(p) => p.into_inner(),
            };

            // Prune expired previews
            let now_inst = Instant::now();
            vault.import_previews.retain(|_, (exp, _)| now_inst <= *exp);

            for sig in signals {
                match sig {
                    VaultSignal::FocusChanged(focused) => {
                        vault.handle_focus_change(focused);
                    }
                    VaultSignal::WindowMinimized => {
                        vault.handle_focus_change(false);
                    }
                    VaultSignal::UserActivity => {
                        vault.touch_activity();
                    }
                    VaultSignal::ScreenLocked => {
                        if vault.is_unlocked() && vault.lock_enabled && vault.settings.lock_on_screen_lock {
                            lock_reason = Some("auto_lock_screen_lock");
                        }
                    }
                    VaultSignal::SleepWake => {
                        if vault.is_unlocked() && vault.lock_enabled {
                            lock_reason = Some("auto_lock_sleep");
                        }
                    }
                }
            }

            if lock_reason.is_none() && vault.is_unlocked() {
                let now = Instant::now();
                let os_idle = get_os_idle_time().ok();
                let screen_locked = is_screen_locked();
                lock_reason = vault.evaluate_auto_lock_reason(now, os_idle, screen_locked);
            }
        }

        if let Some(reason) = lock_reason {
            self.lock_with_reason(app, reason);
        }
    }

    pub fn get_status(&self, db_path: &str) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
        let mut conn = establish_connection(db_path)?;
        Ok(get_vault_status(&mut conn, &vault)?)
    }

    pub fn cancel_auth(&self, operation_id: &str, app: Option<&AppHandle>) -> Result<(), TwofaSecurityError> {
        self.cancel_auth_op(operation_id);

        let should_lock = {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.last_auth_operation_id.as_deref() == Some(operation_id)
        };

        if should_lock {
            if let Some(app_handle) = app {
                self.lock_with_reason(app_handle, "cancelled_auth");
            } else {
                self.auth_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.clipboard_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Ok(mut tokens) = self.operation_tokens.lock() {
                    tokens.clear();
                }
                if let Ok(mut vault) = self.state.lock() {
                    vault.lock();
                }
            }
        }

        Ok(())
    }

    pub async fn cleanup_setup(&self, db_path: &str) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let path = db_path.to_string();
        let store = self.credential_store.clone();

        tauri::async_runtime::spawn_blocking(move || {
            let mut conn = establish_connection(&path)?;
            cleanup_setup_journal(&mut conn, &*store).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task failed: {}", e)))??;

        self.get_status(db_path)
    }

    pub async fn try_auto_unlock(
        &self,
        db_path: &str,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            if vault.is_unlocked() {
                let mut conn = establish_connection(db_path)?;
                return Ok(get_vault_status(&mut conn, &vault)?);
            }
        }

        let path = db_path.to_string();
        let store = self.credential_store.clone();

        let res = tauri::async_runtime::spawn_blocking(move || -> Result<(Zeroizing<[u8; 32]>, TwofaVaultSettings), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.lock_enabled != 0 {
                return Err(TwofaSecurityError::new("MASTER_PASSWORD_REQUIRED", "Vault lock is enabled"));
            }

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "Interrupted transition detected. Master password required."));
            }

            let auto_id = unlock_config
                .auto_credential_id
                .ok_or_else(|| TwofaSecurityError::new("CREDENTIAL_MISSING", "Auto-unlock credential missing"))?;

            let encoded_key = match store.get_password("projects-runner-twofa", &auto_id) {
                Ok(k) => k,
                Err(CredentialStoreError::LockedOrDenied(e)) => {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_LOCKED", format!("Credential store is locked: {}", e)));
                }
                Err(e) => {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to read auto-unlock credential: {}", e)));
                }
            };

            let key_bytes = BASE64.decode(&encoded_key).map_err(|e| TwofaSecurityError::new("CORRUPTED_CREDENTIAL", format!("Corrupted auto-unlock credential: {}", e)))?;
            if key_bytes.len() != 32 {
                return Err(TwofaSecurityError::new("CORRUPTED_CREDENTIAL", "Corrupted auto-unlock data key length"));
            }

            let mut key_arr = [0u8; 32];
            key_arr.copy_from_slice(&key_bytes);

            let settings = TwofaVaultSettings {
                lock_time_setting: LockTimeSetting::from_legacy_or_str(&metadata.lock_time_setting),
                lock_on_screen_lock: metadata.lock_on_screen_lock != 0,
                hide_token_setting: HideTokenSetting::from_legacy_or_str(&metadata.hide_token_setting),
                clear_clipboard_setting: ClearClipboardSetting::from_legacy_or_str(&metadata.clear_clipboard_setting),
                sort_order_setting: SortOrderSetting::from_legacy_or_str(&metadata.sort_order_setting),
            };

            Ok((Zeroizing::new(key_arr), settings))
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Auto unlock task error: {}", e)))?;

        let (key_arr, settings) = match res {
            Ok(v) => v,
            Err(e) => {
                if let Ok(mut vault) = self.state.lock() {
                    if e.code == "CREDENTIAL_STORE_LOCKED" {
                        vault.credential_store_status = CredentialStoreStatus::LockedOrDenied;
                    } else if e.code == "CREDENTIAL_STORE_UNAVAILABLE" {
                        vault.credential_store_status = CredentialStoreStatus::Unavailable;
                    }
                }
                return Err(e);
            }
        };

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by lock or state change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.unlock(*key_arr, settings, false);
            vault.credential_store_status = CredentialStoreStatus::Available;
            vault.last_auth_operation_id = None;
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "auto_unlock".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn setup_vault(
        &self,
        db_path: &str,
        password: &str,
        lock_enabled: bool,
        pin: Option<&str>,
        settings: Option<TwofaVaultSettings>,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        validate_password_format(password).map_err(|e| TwofaSecurityError::new("INVALID_PASSWORD", e))?;
        if lock_enabled {
            if let Some(p) = pin {
                validate_pin_format(p).map_err(|e| TwofaSecurityError::new("INVALID_PIN", e))?;
            }
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        {
            let mut conn = establish_connection(db_path)?;
            if get_vault_metadata(&mut conn)?.is_some() {
                return Err(TwofaSecurityError::new("ALREADY_INITIALIZED", "2FA Vault is already initialized"));
            }
            if has_setup_journal(&mut conn) {
                return Err(TwofaSecurityError::new("SETUP_CLEANUP_REQUIRED", "A previous vault setup was interrupted. Please clean up leftover credentials before setting up a new vault."));
            }
        }

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let initial_settings = settings.unwrap_or_default();
        let pin_owned = pin.map(ToString::to_string);
        let password_owned = Zeroizing::new(password.to_string());

        let (data_key, vault_settings, mode_lock) = tauri::async_runtime::spawn_blocking(move || -> Result<(Zeroizing<[u8; 32]>, TwofaVaultSettings, bool), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let vault_uuid = Uuid::new_v4().to_string();
            let salt = generate_random_bytes::<16>();
            let kwk = derive_kwk(&password_owned, &salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

            let data_key = Zeroizing::new(generate_random_bytes::<32>());
            let data_key_nonce = generate_random_bytes::<24>();
            let encrypted_data_key = encrypt_data(&*kwk, &data_key_nonce, &*data_key, b"pr_twofa_data_key_v1")
                .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

            let now = Utc::now().to_rfc3339();

            let mut auto_credential_id: Option<String> = None;
            let mut pin_credential_id: Option<String> = None;
            let mut pin_salt_opt: Option<Vec<u8>> = None;
            let mut pin_nonce_opt: Option<Vec<u8>> = None;
            let mut pin_wrapped_key_opt: Option<Vec<u8>> = None;

            if !lock_enabled {
                let auto_id = format!("{}:auto:gen-1", vault_uuid);
                auto_credential_id = Some(auto_id);
            } else if pin_owned.is_some() {
                let pin_id = format!("{}:pin:gen-1", vault_uuid);
                pin_credential_id = Some(pin_id);
            }

            sql_query(
                "INSERT INTO twofa_setup_journal (id, vault_uuid, auto_credential_id, pin_credential_id, created_at) VALUES (1, ?, ?, ?, ?)"
            )
            .bind::<Text, _>(&vault_uuid)
            .bind::<diesel::sql_types::Nullable<Text>, _>(&auto_credential_id)
            .bind::<diesel::sql_types::Nullable<Text>, _>(&pin_credential_id)
            .bind::<Text, _>(&now)
            .execute(&mut conn)
            .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to record setup journal: {}", e)))?;

            if !lock_enabled {
                let auto_id = auto_credential_id.as_ref().unwrap();
                if let Err(e) = store.set_password("projects-runner-twofa", auto_id, &BASE64.encode(&*data_key)) {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to store key in OS credential store: {}", e)));
                }
                let read_back = store.get_password("projects-runner-twofa", auto_id).map_err(|e| {
                    TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to verify key in OS credential store: {}", e))
                })?;
                if read_back != BASE64.encode(&*data_key) {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", "Verification readback mismatch"));
                }
            } else if let Some(ref pin_code) = pin_owned {
                let pin_id = pin_credential_id.as_ref().unwrap();
                let device_secret = Zeroizing::new(generate_random_bytes::<32>());
                if let Err(e) = store.set_password("projects-runner-twofa", pin_id, &BASE64.encode(&*device_secret)) {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to store device secret in OS credential store: {}", e)));
                }
                let read_back = store.get_password("projects-runner-twofa", pin_id).map_err(|e| {
                    TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to verify device secret: {}", e))
                })?;
                if read_back != BASE64.encode(&*device_secret) {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", "Device secret verification mismatch"));
                }

                let pin_salt = generate_random_bytes::<16>();
                let pin_nonce = generate_random_bytes::<24>();
                let pkwk = derive_pin_kwk(pin_code, &*device_secret, &pin_salt)
                    .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
                let pin_aad = format!("pr_twofa_pin:{}:v1", vault_uuid);
                let pin_wrapped_key = encrypt_data(&*pkwk, &pin_nonce, &*data_key, pin_aad.as_bytes())
                    .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

                pin_salt_opt = Some(pin_salt.to_vec());
                pin_nonce_opt = Some(pin_nonce.to_vec());
                pin_wrapped_key_opt = Some(pin_wrapped_key);
            }

            with_transaction(&mut conn, |c| {
                sql_query(
                    "INSERT INTO twofa_vault_metadata (
                        id, version, kdf_salt, kdf_memory_kib, kdf_iterations, kdf_parallelism,
                        encrypted_data_key, data_key_nonce, lock_time_setting, lock_on_screen_lock,
                        hide_token_setting, clear_clipboard_setting, sort_order_setting, created_at, updated_at
                    ) VALUES (1, 1, ?, 65536, 3, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                .bind::<Binary, _>(&salt)
                .bind::<Binary, _>(&encrypted_data_key)
                .bind::<Binary, _>(&data_key_nonce)
                .bind::<Text, _>(initial_settings.lock_time_setting.as_str())
                .bind::<Integer, _>(if initial_settings.lock_on_screen_lock { 1 } else { 0 })
                .bind::<Text, _>(initial_settings.hide_token_setting.as_str())
                .bind::<Text, _>(initial_settings.clear_clipboard_setting.as_str())
                .bind::<Text, _>(initial_settings.sort_order_setting.as_str())
                .bind::<Text, _>(&now)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to initialize vault metadata: {}", e))?;

                sql_query(
                    "INSERT INTO twofa_unlock_config (
                        id, vault_uuid, format_version, lock_enabled, credential_generation,
                        auto_credential_id, pin_credential_id, pin_salt, pin_nonce, pin_wrapped_key,
                        pin_failed_attempts, pending_operation, pending_credential_id, pending_journal, updated_at
                    ) VALUES (1, ?, 1, ?, 1, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)"
                )
                .bind::<Text, _>(&vault_uuid)
                .bind::<Integer, _>(if lock_enabled { 1 } else { 0 })
                .bind::<diesel::sql_types::Nullable<Text>, _>(&auto_credential_id)
                .bind::<diesel::sql_types::Nullable<Text>, _>(&pin_credential_id)
                .bind::<diesel::sql_types::Nullable<Binary>, _>(&pin_salt_opt)
                .bind::<diesel::sql_types::Nullable<Binary>, _>(&pin_nonce_opt)
                .bind::<diesel::sql_types::Nullable<Binary>, _>(&pin_wrapped_key_opt)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to initialize unlock config: {}", e))?;

                sql_query("DELETE FROM twofa_setup_journal WHERE id = 1")
                    .execute(c)
                    .map_err(|e| format!("Failed to clear setup journal: {}", e))?;

                Ok(())
            }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;

            Ok((data_key, initial_settings, lock_enabled))
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Setup task error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.unlock(*data_key, vault_settings, mode_lock);
            vault.credential_store_status = CredentialStoreStatus::Available;
            vault.last_auth_operation_id = None;
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "setup_vault".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn unlock_vault(
        &self,
        db_path: &str,
        password: &str,
        operation_id: Option<&str>,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        if let Some(op_id) = operation_id {
            if self.is_auth_cancelled(op_id) {
                return Err(TwofaSecurityError::new("AUTH_CANCELLED", "Operation was cancelled"));
            }
        }

        let path = db_path.to_string();
        let pwd_clone = Zeroizing::new(password.to_string());

        let (decrypted_key, settings, lock_enabled) = tauri::async_runtime::spawn_blocking(move || -> Result<(Zeroizing<[u8; 32]>, TwofaVaultSettings, bool), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config_opt = get_unlock_config(&mut conn)?;

            let kwk = derive_kwk(&pwd_clone, &metadata.kdf_salt)
                .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let nonce: [u8; 24] = metadata
                .data_key_nonce
                .as_slice()
                .try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;

            let decrypted_key_bytes = decrypt_data(
                &*kwk,
                &nonce,
                &metadata.encrypted_data_key,
                b"pr_twofa_data_key_v1",
            )
            .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu chính không chính xác"))?;

            if decrypted_key_bytes.len() != 32 {
                return Err(TwofaSecurityError::new("CORRUPTED_KEY", "Decrypted data key has invalid length"));
            }

            let mut key_arr = [0u8; 32];
            key_arr.copy_from_slice(&decrypted_key_bytes);

            let settings = TwofaVaultSettings {
                lock_time_setting: LockTimeSetting::from_legacy_or_str(&metadata.lock_time_setting),
                lock_on_screen_lock: metadata.lock_on_screen_lock != 0,
                hide_token_setting: HideTokenSetting::from_legacy_or_str(&metadata.hide_token_setting),
                clear_clipboard_setting: ClearClipboardSetting::from_legacy_or_str(&metadata.clear_clipboard_setting),
                sort_order_setting: SortOrderSetting::from_legacy_or_str(&metadata.sort_order_setting),
            };

            let mut lock_enabled = true;
            if let Some(ref uc) = unlock_config_opt {
                let has_pending = uc.pending_operation.is_some() || uc.pending_journal.is_some();
                let now = Utc::now().to_rfc3339();
                if has_pending {
                    let _ = sql_query("UPDATE twofa_unlock_config SET pin_failed_attempts = 0, updated_at = ? WHERE id = 1")
                        .bind::<Text, _>(&now)
                        .execute(&mut conn);
                    lock_enabled = true;
                } else {
                    sql_query("UPDATE twofa_unlock_config SET pin_failed_attempts = 0, updated_at = ? WHERE id = 1")
                        .bind::<Text, _>(&now)
                        .execute(&mut conn)
                        .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to reset PIN attempts: {}", e)))?;
                    lock_enabled = uc.lock_enabled != 0;
                }
            }

            Ok((Zeroizing::new(key_arr), settings, lock_enabled))
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Unlock task error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        if let Some(op_id) = operation_id {
            if self.is_auth_cancelled(op_id) {
                return Err(TwofaSecurityError::new("AUTH_CANCELLED", "Operation was cancelled"));
            }
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.unlock(*decrypted_key, settings, lock_enabled);
            vault.last_auth_operation_id = operation_id.map(ToString::to_string);
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "unlock_password".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn unlock_with_pin(
        &self,
        db_path: &str,
        pin: &str,
        operation_id: Option<&str>,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        validate_pin_format(pin).map_err(|e| TwofaSecurityError::new("INVALID_PIN", e))?;

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        if let Some(op_id) = operation_id {
            if self.is_auth_cancelled(op_id) {
                return Err(TwofaSecurityError::new("AUTH_CANCELLED", "Operation was cancelled"));
            }
        }

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let pin_clone = Zeroizing::new(pin.to_string());

        let (decrypted_key, settings) = tauri::async_runtime::spawn_blocking(move || -> Result<(Zeroizing<[u8; 32]>, TwofaVaultSettings), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "Interrupted transition detected. Master password required."));
            }

            if !unlock_config.is_pin_enabled() {
                return Err(TwofaSecurityError::new("MASTER_PASSWORD_REQUIRED", "PIN is not configured"));
            }

            if unlock_config.pin_failed_attempts >= 5 {
                return Err(TwofaSecurityError::new("PIN_BLOCKED", "Maximum PIN attempts reached. Master password required."));
            }

            let pin_cred_id = unlock_config.pin_credential_id.as_deref().unwrap();
            let encoded_device_secret = match store.get_password("projects-runner-twofa", pin_cred_id) {
                Ok(s) => s,
                Err(e) => {
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to read device credential: {}", e)));
                }
            };

            let device_secret = Zeroizing::new(BASE64.decode(&encoded_device_secret)
                .map_err(|e| TwofaSecurityError::new("CORRUPTED_CREDENTIAL", format!("Corrupted device secret: {}", e)))?);

            let now = Utc::now().to_rfc3339();
            let rows_affected = sql_query(
                "UPDATE twofa_unlock_config SET pin_failed_attempts = pin_failed_attempts + 1, updated_at = ? WHERE id = 1 AND pin_failed_attempts < 5"
            )
            .bind::<Text, _>(&now)
            .execute(&mut conn)
            .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to record PIN attempt: {}", e)))?;

            if rows_affected == 0 {
                return Err(TwofaSecurityError::new("PIN_BLOCKED", "Maximum PIN attempts reached. Master password required."));
            }
            let updated_attempts = unlock_config.pin_failed_attempts + 1;

            let pin_salt = unlock_config.pin_salt.as_deref().unwrap();
            let pkwk = derive_pin_kwk(&pin_clone, &*device_secret, pin_salt)
                .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

            let pin_nonce: [u8; 24] = unlock_config.pin_nonce.as_ref().unwrap().as_slice().try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted PIN nonce"))?;
            let pin_wrapped = unlock_config.pin_wrapped_key.as_ref().unwrap();
            let pin_aad = format!("pr_twofa_pin:{}:v1", unlock_config.vault_uuid);

            match decrypt_data(&*pkwk, &pin_nonce, pin_wrapped, pin_aad.as_bytes()) {
                Ok(data_key_bytes) => {
                    if data_key_bytes.len() != 32 {
                        return Err(TwofaSecurityError::new("CORRUPTED_KEY", "Invalid data key length"));
                    }

                    sql_query("UPDATE twofa_unlock_config SET pin_failed_attempts = 0, updated_at = ? WHERE id = 1")
                        .bind::<Text, _>(&now)
                        .execute(&mut conn)
                        .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to reset PIN attempts: {}", e)))?;

                    let mut key_arr = [0u8; 32];
                    key_arr.copy_from_slice(&data_key_bytes);

                    let settings = TwofaVaultSettings {
                        lock_time_setting: LockTimeSetting::from_legacy_or_str(&metadata.lock_time_setting),
                        lock_on_screen_lock: metadata.lock_on_screen_lock != 0,
                        hide_token_setting: HideTokenSetting::from_legacy_or_str(&metadata.hide_token_setting),
                        clear_clipboard_setting: ClearClipboardSetting::from_legacy_or_str(&metadata.clear_clipboard_setting),
                        sort_order_setting: SortOrderSetting::from_legacy_or_str(&metadata.sort_order_setting),
                    };

                    Ok((Zeroizing::new(key_arr), settings))
                }
                Err(_) => {
                    let remaining = 5 - updated_attempts;
                    if remaining <= 0 {
                        Err(TwofaSecurityError::new("PIN_BLOCKED", "Incorrect PIN. Maximum attempts reached. Master password required."))
                    } else {
                        Err(TwofaSecurityError::new("INVALID_PIN", format!("Incorrect PIN. {} attempts remaining.", remaining)))
                    }
                }
            }
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("PIN unlock task error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        if let Some(op_id) = operation_id {
            if self.is_auth_cancelled(op_id) {
                return Err(TwofaSecurityError::new("AUTH_CANCELLED", "Operation was cancelled"));
            }
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.unlock(*decrypted_key, settings, true);
            vault.last_auth_operation_id = operation_id.map(ToString::to_string);
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "unlock_pin".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub fn lock_vault(&self, db_path: &str, app: Option<&AppHandle>) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let is_unlocked = {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            if !vault.is_unlocked() {
                let mut conn = establish_connection(db_path)?;
                return Ok(get_vault_status(&mut conn, &vault)?);
            }
            if !vault.lock_enabled {
                return Err(TwofaSecurityError::new("NOT_LOCKED_MODE", "Manual lock is disabled when vault is in unlocked mode"));
            }
            true
        };

        if is_unlocked {
            if let Some(app_handle) = app {
                self.lock_with_reason(app_handle, "manual_lock");
            } else {
                self.auth_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.clipboard_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Ok(mut tokens) = self.operation_tokens.lock() {
                    tokens.clear();
                }
                if let Ok(mut vault) = self.state.lock() {
                    vault.lock();
                }
            }
        }

        self.get_status(db_path)
    }

    pub fn touch_activity(&self, expected_session_id: &str) -> Result<(), TwofaSecurityError> {
        let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
        vault.validate_session(expected_session_id).map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        vault.touch_activity();
        Ok(())
    }

    pub async fn set_lock_enabled(
        &self,
        db_path: &str,
        lock_enabled: bool,
        master_password: &str,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let pwd = Zeroizing::new(master_password.to_string());

        tauri::async_runtime::spawn_blocking(move || -> Result<(), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "A previous security transition was interrupted. Master password required."));
            }

            let kwk = derive_kwk(&pwd, &metadata.kdf_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let nonce: [u8; 24] = metadata.data_key_nonce.as_slice().try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;
            let data_key_bytes = decrypt_data(&*kwk, &nonce, &metadata.encrypted_data_key, b"pr_twofa_data_key_v1")
                .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu chính không chính xác"))?;

            if (unlock_config.lock_enabled != 0) == lock_enabled {
                return Ok(());
            }

            let next_gen = unlock_config.credential_generation + 1;
            let now = Utc::now().to_rfc3339();

            if !lock_enabled {
                let target_cred_id = format!("{}:auto:gen-{}", unlock_config.vault_uuid, next_gen);
                let mut old_creds = Vec::new();
                if let Some(ref aid) = unlock_config.auto_credential_id {
                    old_creds.push(aid.clone());
                }
                if let Some(ref pid) = unlock_config.pin_credential_id {
                    old_creds.push(pid.clone());
                }

                let journal = SecurityTransitionJournal::new(
                    unlock_config.vault_uuid.clone(),
                    "disable_lock".to_string(),
                    unlock_config.credential_generation,
                    next_gen,
                    old_creds.clone(),
                    vec![target_cred_id.clone()],
                );
                let journal_json = serde_json::to_string(&journal).map_err(|e| TwofaSecurityError::new("JOURNAL_ERROR", e.to_string()))?;

                sql_query("UPDATE twofa_unlock_config SET pending_operation = 'disable_lock', pending_credential_id = ?, pending_journal = ?, updated_at = ? WHERE id = 1")
                    .bind::<Text, _>(&target_cred_id)
                    .bind::<Text, _>(&journal_json)
                    .bind::<Text, _>(&now)
                    .execute(&mut conn)
                    .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e.to_string()))?;

                store.set_password("projects-runner-twofa", &target_cred_id, &BASE64.encode(&data_key_bytes))
                    .map_err(|e| TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", e.to_string()))?;

                let read_back = store.get_password("projects-runner-twofa", &target_cred_id).map_err(|e| {
                    let _ = store.delete_password("projects-runner-twofa", &target_cred_id);
                    TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Verify read failed: {}", e))
                })?;
                if read_back != BASE64.encode(&data_key_bytes) {
                    let _ = store.delete_password("projects-runner-twofa", &target_cred_id);
                    return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", "Readback verification mismatch"));
                }

                for old_id in &old_creds {
                    match store.delete_password("projects-runner-twofa", old_id) {
                        Ok(()) => {}
                        Err(CredentialStoreError::NotFound) => {}
                        Err(e) => return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to delete old credential: {}", e))),
                    }
                }

                with_transaction(&mut conn, |c| {
                    sql_query(
                        "UPDATE twofa_unlock_config SET
                            lock_enabled = 0,
                            credential_generation = ?,
                            auto_credential_id = ?,
                            pin_credential_id = NULL,
                            pin_salt = NULL,
                            pin_nonce = NULL,
                            pin_wrapped_key = NULL,
                            pin_failed_attempts = 0,
                            pending_operation = NULL,
                            pending_credential_id = NULL,
                            pending_journal = NULL,
                            updated_at = ?
                        WHERE id = 1"
                    )
                    .bind::<Integer, _>(next_gen)
                    .bind::<Text, _>(&target_cred_id)
                    .bind::<Text, _>(&now)
                    .execute(c)
                    .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                    Ok(())
                }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;
            } else {
                let mut old_creds = Vec::new();
                if let Some(ref aid) = unlock_config.auto_credential_id {
                    old_creds.push(aid.clone());
                }

                let journal = SecurityTransitionJournal::new(
                    unlock_config.vault_uuid.clone(),
                    "enable_lock".to_string(),
                    unlock_config.credential_generation,
                    next_gen,
                    old_creds.clone(),
                    vec![],
                );
                let journal_json = serde_json::to_string(&journal).map_err(|e| TwofaSecurityError::new("JOURNAL_ERROR", e.to_string()))?;

                sql_query("UPDATE twofa_unlock_config SET pending_operation = 'enable_lock', pending_credential_id = NULL, pending_journal = ?, updated_at = ? WHERE id = 1")
                    .bind::<Text, _>(&journal_json)
                    .bind::<Text, _>(&now)
                    .execute(&mut conn)
                    .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e.to_string()))?;

                for old_id in &old_creds {
                    match store.delete_password("projects-runner-twofa", old_id) {
                        Ok(()) => {}
                        Err(CredentialStoreError::NotFound) => {}
                        Err(e) => return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to delete old credential: {}", e))),
                    }
                }

                with_transaction(&mut conn, |c| {
                    sql_query(
                        "UPDATE twofa_unlock_config SET
                            lock_enabled = 1,
                            credential_generation = ?,
                            auto_credential_id = NULL,
                            pending_operation = NULL,
                            pending_credential_id = NULL,
                            pending_journal = NULL,
                            updated_at = ?
                        WHERE id = 1"
                    )
                    .bind::<Integer, _>(next_gen)
                    .bind::<Text, _>(&now)
                    .execute(c)
                    .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                    Ok(())
                }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;
            }

            Ok(())
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task join error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        if lock_enabled {
            {
                let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
                vault.validate_session_and_revision(expected_session_id, expected_revision)
                    .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
                vault.lock_enabled = true;
                vault.revision += 1;
            }
            if let Some(app_handle) = app {
                self.lock_with_reason(app_handle, "enable_lock");
            } else {
                self.auth_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.clipboard_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Ok(mut tokens) = self.operation_tokens.lock() { tokens.clear(); }
                if let Ok(mut v) = self.state.lock() { v.lock(); }
            }
            self.get_status(db_path)
        } else {
            let status = {
                let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
                vault.validate_session_and_revision(expected_session_id, expected_revision)
                    .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
                vault.lock_enabled = false;
                vault.revision += 1;
                vault.touch_activity();
                let mut conn = establish_connection(db_path)?;
                get_vault_status(&mut conn, &vault)?
            };

            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    "twofa:vault-state-changed",
                    TwofaVaultStateChangedEvent {
                        session_id: status.session_id.clone(),
                        revision: status.revision,
                        is_unlocked: status.is_unlocked,
                        reason: "disable_lock".to_string(),
                    },
                );
            }

            Ok(status)
        }
    }

    pub async fn set_pin(
        &self,
        db_path: &str,
        pin: &str,
        master_password: &str,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        validate_pin_format(pin).map_err(|e| TwofaSecurityError::new("INVALID_PIN", e))?;

        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let pin_clone = Zeroizing::new(pin.to_string());
        let pwd = Zeroizing::new(master_password.to_string());

        tauri::async_runtime::spawn_blocking(move || -> Result<(), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "A previous security transition was interrupted. Master password required."));
            }

            let kwk = derive_kwk(&pwd, &metadata.kdf_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let nonce: [u8; 24] = metadata.data_key_nonce.as_slice().try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;
            let data_key_bytes = decrypt_data(&*kwk, &nonce, &metadata.encrypted_data_key, b"pr_twofa_data_key_v1")
                .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu chính không chính xác"))?;

            let next_gen = unlock_config.credential_generation + 1;
            let target_cred_id = format!("{}:pin:gen-{}", unlock_config.vault_uuid, next_gen);
            let now = Utc::now().to_rfc3339();

            let mut old_creds = Vec::new();
            if let Some(ref pid) = unlock_config.pin_credential_id {
                old_creds.push(pid.clone());
            }
            if let Some(ref aid) = unlock_config.auto_credential_id {
                old_creds.push(aid.clone());
            }

            let journal = SecurityTransitionJournal::new(
                unlock_config.vault_uuid.clone(),
                "set_pin".to_string(),
                unlock_config.credential_generation,
                next_gen,
                old_creds.clone(),
                vec![target_cred_id.clone()],
            );
            let journal_json = serde_json::to_string(&journal).map_err(|e| TwofaSecurityError::new("JOURNAL_ERROR", e.to_string()))?;

            sql_query("UPDATE twofa_unlock_config SET pending_operation = 'set_pin', pending_credential_id = ?, pending_journal = ?, updated_at = ? WHERE id = 1")
                .bind::<Text, _>(&target_cred_id)
                .bind::<Text, _>(&journal_json)
                .bind::<Text, _>(&now)
                .execute(&mut conn)
                .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e.to_string()))?;

            let device_secret = Zeroizing::new(generate_random_bytes::<32>());
            store.set_password("projects-runner-twofa", &target_cred_id, &BASE64.encode(&*device_secret))
                .map_err(|e| TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", e.to_string()))?;

            let read_back = store.get_password("projects-runner-twofa", &target_cred_id).map_err(|e| {
                let _ = store.delete_password("projects-runner-twofa", &target_cred_id);
                TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Verify read failed: {}", e))
            })?;
            if read_back != BASE64.encode(&*device_secret) {
                let _ = store.delete_password("projects-runner-twofa", &target_cred_id);
                return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", "Readback verification mismatch"));
            }

            let pin_salt = generate_random_bytes::<16>();
            let pin_nonce = generate_random_bytes::<24>();
            let pkwk = derive_pin_kwk(&pin_clone, &*device_secret, &pin_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let pin_aad = format!("pr_twofa_pin:{}:v1", unlock_config.vault_uuid);
            let pin_wrapped_key = encrypt_data(&*pkwk, &pin_nonce, &data_key_bytes, pin_aad.as_bytes())
                .map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

            for old_id in &old_creds {
                if old_id != &target_cred_id {
                    match store.delete_password("projects-runner-twofa", old_id) {
                        Ok(()) => {}
                        Err(CredentialStoreError::NotFound) => {}
                        Err(e) => return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to delete old credential: {}", e))),
                    }
                }
            }

            with_transaction(&mut conn, |c| {
                sql_query(
                    "UPDATE twofa_unlock_config SET
                        lock_enabled = 1,
                        credential_generation = ?,
                        auto_credential_id = NULL,
                        pin_credential_id = ?,
                        pin_salt = ?,
                        pin_nonce = ?,
                        pin_wrapped_key = ?,
                        pin_failed_attempts = 0,
                        pending_operation = NULL,
                        pending_credential_id = NULL,
                        pending_journal = NULL,
                        updated_at = ?
                    WHERE id = 1"
                )
                .bind::<Integer, _>(next_gen)
                .bind::<Text, _>(&target_cred_id)
                .bind::<Binary, _>(&pin_salt)
                .bind::<Binary, _>(&pin_nonce)
                .bind::<Binary, _>(&pin_wrapped_key)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                Ok(())
            }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;

            Ok(())
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task join error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
            vault.lock_enabled = true;
            vault.revision += 1;
            vault.touch_activity();
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "set_pin".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn remove_pin(
        &self,
        db_path: &str,
        master_password: &str,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let pwd = Zeroizing::new(master_password.to_string());

        tauri::async_runtime::spawn_blocking(move || -> Result<(), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "A previous security transition was interrupted. Master password required."));
            }

            let kwk = derive_kwk(&pwd, &metadata.kdf_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let nonce: [u8; 24] = metadata.data_key_nonce.as_slice().try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;
            let _ = decrypt_data(&*kwk, &nonce, &metadata.encrypted_data_key, b"pr_twofa_data_key_v1")
                .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu chính không chính xác"))?;

            let next_gen = unlock_config.credential_generation + 1;
            let now = Utc::now().to_rfc3339();

            let mut old_creds = Vec::new();
            if let Some(ref pid) = unlock_config.pin_credential_id {
                old_creds.push(pid.clone());
            }

            let journal = SecurityTransitionJournal::new(
                unlock_config.vault_uuid.clone(),
                "remove_pin".to_string(),
                unlock_config.credential_generation,
                next_gen,
                old_creds.clone(),
                vec![],
            );
            let journal_json = serde_json::to_string(&journal).map_err(|e| TwofaSecurityError::new("JOURNAL_ERROR", e.to_string()))?;

            sql_query("UPDATE twofa_unlock_config SET pending_operation = 'remove_pin', pending_journal = ?, updated_at = ? WHERE id = 1")
                .bind::<Text, _>(&journal_json)
                .bind::<Text, _>(&now)
                .execute(&mut conn)
                .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e.to_string()))?;

            for old_id in &old_creds {
                match store.delete_password("projects-runner-twofa", old_id) {
                    Ok(()) => {}
                    Err(CredentialStoreError::NotFound) => {}
                    Err(e) => return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to delete old credential: {}", e))),
                }
            }

            with_transaction(&mut conn, |c| {
                sql_query(
                    "UPDATE twofa_unlock_config SET
                        credential_generation = ?,
                        pin_credential_id = NULL,
                        pin_salt = NULL,
                        pin_nonce = NULL,
                        pin_wrapped_key = NULL,
                        pin_failed_attempts = 0,
                        pending_operation = NULL,
                        pending_credential_id = NULL,
                        pending_journal = NULL,
                        updated_at = ?
                    WHERE id = 1"
                )
                .bind::<Integer, _>(next_gen)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                Ok(())
            }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;

            Ok(())
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task join error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
            vault.revision += 1;
            vault.touch_activity();
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "remove_pin".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn change_password(
        &self,
        db_path: &str,
        old_password: &str,
        new_password: &str,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        validate_password_format(new_password).map_err(|e| TwofaSecurityError::new("INVALID_PASSWORD", e))?;

        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let old_pwd = Zeroizing::new(old_password.to_string());
        let new_pwd = Zeroizing::new(new_password.to_string());

        tauri::async_runtime::spawn_blocking(move || -> Result<(), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            if unlock_config.pending_operation.is_some() || unlock_config.pending_journal.is_some() {
                return Err(TwofaSecurityError::new("RECOVERY_REQUIRED", "A previous security transition was interrupted. Master password required."));
            }

            let old_kwk = derive_kwk(&old_pwd, &metadata.kdf_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let old_nonce: [u8; 24] = metadata
                .data_key_nonce
                .as_slice()
                .try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;

            let data_key_bytes = decrypt_data(
                &*old_kwk,
                &old_nonce,
                &metadata.encrypted_data_key,
                b"pr_twofa_data_key_v1",
            )
            .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu hiện tại không chính xác"))?;

            let new_salt = generate_random_bytes::<16>();
            let new_kwk = derive_kwk(&new_pwd, &new_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let new_nonce = generate_random_bytes::<24>();

            let new_encrypted_data_key = encrypt_data(
                &*new_kwk,
                &new_nonce,
                &data_key_bytes,
                b"pr_twofa_data_key_v1",
            ).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;

            let now = Utc::now().to_rfc3339();
            let next_gen = unlock_config.credential_generation + 1;

            let mut old_creds = Vec::new();
            if let Some(ref pid) = unlock_config.pin_credential_id {
                old_creds.push(pid.clone());
            }

            let journal = SecurityTransitionJournal::new(
                unlock_config.vault_uuid.clone(),
                "change_password".to_string(),
                unlock_config.credential_generation,
                next_gen,
                old_creds.clone(),
                vec![],
            );
            let journal_json = serde_json::to_string(&journal).map_err(|e| TwofaSecurityError::new("JOURNAL_ERROR", e.to_string()))?;

            sql_query("UPDATE twofa_unlock_config SET pending_operation = 'change_password', pending_journal = ?, updated_at = ? WHERE id = 1")
                .bind::<Text, _>(&journal_json)
                .bind::<Text, _>(&now)
                .execute(&mut conn)
                .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e.to_string()))?;

            for old_id in &old_creds {
                match store.delete_password("projects-runner-twofa", old_id) {
                    Ok(()) => {}
                    Err(CredentialStoreError::NotFound) => {}
                    Err(e) => return Err(TwofaSecurityError::new("CREDENTIAL_STORE_UNAVAILABLE", format!("Failed to delete old credential: {}", e))),
                }
            }

            with_transaction(&mut conn, |c| {
                sql_query(
                    "UPDATE twofa_vault_metadata SET
                        kdf_salt = ?,
                        encrypted_data_key = ?,
                        data_key_nonce = ?,
                        updated_at = ?
                    WHERE id = 1"
                )
                .bind::<Binary, _>(&new_salt)
                .bind::<Binary, _>(&new_encrypted_data_key)
                .bind::<Binary, _>(&new_nonce)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to update master password: {}", e))?;

                sql_query(
                    "UPDATE twofa_unlock_config SET
                        credential_generation = ?,
                        pin_credential_id = NULL,
                        pin_salt = NULL,
                        pin_nonce = NULL,
                        pin_wrapped_key = NULL,
                        pin_failed_attempts = 0,
                        pending_operation = NULL,
                        pending_credential_id = NULL,
                        pending_journal = NULL,
                        updated_at = ?
                    WHERE id = 1"
                )
                .bind::<Integer, _>(next_gen)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                Ok(())
            }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;

            Ok(())
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task join error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
            vault.session_id = Some(Uuid::new_v4().to_string());
            vault.revision += 1;
            vault.touch_activity();
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "change_password".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub async fn retry_recovery(
        &self,
        db_path: &str,
        master_password: &str,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        {
            let vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
        }

        let _op = self.acquire_security_op().map_err(|e| TwofaSecurityError::new("BUSY", e))?;
        let start_epoch = self.current_auth_epoch();

        let path = db_path.to_string();
        let store = self.credential_store.clone();
        let pwd = Zeroizing::new(master_password.to_string());

        tauri::async_runtime::spawn_blocking(move || -> Result<(), TwofaSecurityError> {
            let mut conn = establish_connection(&path)?;
            let metadata = get_vault_metadata(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("NOT_INITIALIZED", "Vault has not been set up yet"))?;
            let unlock_config = get_unlock_config(&mut conn)?
                .ok_or_else(|| TwofaSecurityError::new("CONFIG_MISSING", "Unlock configuration missing"))?;

            let kwk = derive_kwk(&pwd, &metadata.kdf_salt).map_err(|e| TwofaSecurityError::new("CRYPTO_ERROR", e))?;
            let nonce: [u8; 24] = metadata.data_key_nonce.as_slice().try_into()
                .map_err(|_| TwofaSecurityError::new("CORRUPTED_KEY", "Corrupted data key nonce"))?;
            let _ = decrypt_data(&*kwk, &nonce, &metadata.encrypted_data_key, b"pr_twofa_data_key_v1")
                .map_err(|_| TwofaSecurityError::new("INVALID_PASSWORD", "Mật khẩu chính không chính xác"))?;

            let mut cred_ids = Vec::new();
            if let Some(ref j_str) = unlock_config.pending_journal {
                match serde_json::from_str::<SecurityTransitionJournal>(j_str) {
                    Ok(journal) => {
                        journal.validate(&unlock_config.vault_uuid).map_err(|e| TwofaSecurityError::new("RECOVERY_ERROR", e))?;
                        cred_ids.extend(journal.old_credential_ids);
                        cred_ids.extend(journal.new_credential_ids);
                    }
                    Err(e) => {
                        return Err(TwofaSecurityError::new("RECOVERY_ERROR", format!("Corrupted transition journal JSON: {}", e)));
                    }
                }
            }
            if let Some(ref pid) = unlock_config.pending_credential_id {
                cred_ids.push(pid.clone());
            }
            if let Some(ref aid) = unlock_config.auto_credential_id {
                cred_ids.push(aid.clone());
            }
            if let Some(ref pin_id) = unlock_config.pin_credential_id {
                cred_ids.push(pin_id.clone());
            }

            cred_ids.retain(|id| is_valid_vault_credential_id(&unlock_config.vault_uuid, id));
            cred_ids.sort();
            cred_ids.dedup();

            for cid in &cred_ids {
                match store.delete_password("projects-runner-twofa", cid) {
                    Ok(()) => {}
                    Err(CredentialStoreError::NotFound) => {}
                    Err(e) => {
                        return Err(TwofaSecurityError::new("RECOVERY_CLEANUP_FAILED", format!("Failed to delete credential {}: {}", cid, e)));
                    }
                }
            }

            let now = Utc::now().to_rfc3339();
            let next_gen = unlock_config.credential_generation + 1;
            with_transaction(&mut conn, |c| {
                sql_query(
                    "UPDATE twofa_unlock_config SET
                        lock_enabled = 1,
                        credential_generation = ?,
                        auto_credential_id = NULL,
                        pin_credential_id = NULL,
                        pin_salt = NULL,
                        pin_nonce = NULL,
                        pin_wrapped_key = NULL,
                        pin_failed_attempts = 0,
                        pending_operation = NULL,
                        pending_credential_id = NULL,
                        pending_journal = NULL,
                        updated_at = ?
                    WHERE id = 1"
                )
                .bind::<Integer, _>(next_gen)
                .bind::<Text, _>(&now)
                .execute(c)
                .map_err(|e| format!("Failed to update unlock config: {}", e))?;
                Ok(())
            }).map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", e))?;

            Ok(())
        })
        .await
        .map_err(|e| TwofaSecurityError::new("TASK_FAILED", format!("Task join error: {}", e)))??;

        if self.current_auth_epoch() != start_epoch {
            return Err(TwofaSecurityError::new("SESSION_EXPIRED", "Operation invalidated by concurrent change"));
        }

        let status = {
            let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
            vault.validate_session_and_revision(expected_session_id, expected_revision)
                .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;
            vault.session_id = Some(Uuid::new_v4().to_string());
            vault.lock_enabled = true;
            vault.revision += 1;
            vault.touch_activity();
            let mut conn = establish_connection(db_path)?;
            get_vault_status(&mut conn, &vault)?
        };

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: status.session_id.clone(),
                    revision: status.revision,
                    is_unlocked: status.is_unlocked,
                    reason: "recovery_completed".to_string(),
                },
            );
        }

        Ok(status)
    }

    pub fn update_settings(
        &self,
        db_path: &str,
        settings: TwofaVaultSettings,
        expected_session_id: &str,
        expected_revision: u64,
        app: Option<&AppHandle>,
    ) -> Result<TwofaVaultStatus, TwofaSecurityError> {
        let mut conn = establish_connection(db_path)?;
        let mut vault = self.state.lock().map_err(|e| TwofaSecurityError::new("LOCK_FAILED", e.to_string()))?;
        vault.validate_session_and_revision(expected_session_id, expected_revision)
            .map_err(|e| TwofaSecurityError::new("SESSION_EXPIRED", e))?;

        let now = Utc::now().to_rfc3339();
        sql_query(
            "UPDATE twofa_vault_metadata SET
                lock_time_setting = ?,
                lock_on_screen_lock = ?,
                hide_token_setting = ?,
                clear_clipboard_setting = ?,
                sort_order_setting = ?,
                updated_at = ?
            WHERE id = 1"
        )
        .bind::<Text, _>(settings.lock_time_setting.as_str())
        .bind::<Integer, _>(if settings.lock_on_screen_lock { 1 } else { 0 })
        .bind::<Text, _>(settings.hide_token_setting.as_str())
        .bind::<Text, _>(settings.clear_clipboard_setting.as_str())
        .bind::<Text, _>(settings.sort_order_setting.as_str())
        .bind::<Text, _>(&now)
        .execute(&mut conn)
        .map_err(|e| TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to update vault settings: {}", e)))?;

        vault.settings = settings;
        vault.revision += 1;
        vault.touch_activity();

        let status = get_vault_status(&mut conn, &vault)?;

        if let Some(app_handle) = app {
            let _ = app_handle.emit(
                "twofa:vault-state-changed",
                TwofaVaultStateChangedEvent {
                    session_id: vault.session_id.clone(),
                    revision: vault.revision,
                    is_unlocked: vault.is_unlocked(),
                    reason: "settings_updated".to_string(),
                },
            );
        }

        Ok(status)
    }
}

#[cfg(windows)]
pub fn atomic_replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    extern "system" {
        fn MoveFileExW(lpExistingFileName: *const u16, lpNewFileName: *const u16, dwFlags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;

    let res = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if res == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn atomic_replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}


// ============================================================================
// 5. Database Transaction & Cryptographic Functions
// ============================================================================

pub fn establish_connection(db_path: &str) -> Result<SqliteConnection, TwofaSecurityError> {
    let mut conn = SqliteConnection::establish(db_path).map_err(|e| {
        TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to connect to database: {}", e))
    })?;
    conn.batch_execute("PRAGMA foreign_keys = ON;").map_err(|e| {
        TwofaSecurityError::new("STORAGE_ERROR", format!("Failed to set pragma foreign_keys: {}", e))
    })?;
    Ok(conn)
}

pub fn with_transaction<T, F>(conn: &mut SqliteConnection, f: F) -> Result<T, String>
where
    F: FnOnce(&mut SqliteConnection) -> Result<T, String>,
{
    conn.batch_execute("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    match f(conn) {
        Ok(val) => {
            conn.batch_execute("COMMIT;")
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;
            Ok(val)
        }
        Err(err) => {
            let _ = conn.batch_execute("ROLLBACK;");
            Err(err)
        }
    }
}

pub fn generate_random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::rng().fill(&mut bytes);
    bytes
}

pub fn validate_password_format(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("Password must be at least 8 characters long".to_string());
    }
    Ok(())
}

pub fn validate_pin_format(pin: &str) -> Result<(), String> {
    if pin.len() == 6 && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err("INVALID_PIN: PIN must be exactly 6 digits".to_string())
    }
}

pub fn derive_kwk(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    validate_password_format(password)?;
    let params = Argon2Params::new(65536, 3, 1, Some(32))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Argon2Algorithm::Argon2id, Argon2Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Argon2 hash failed: {}", e))?;
    Ok(Zeroizing::new(key))
}

pub fn derive_pin_kwk(pin: &str, device_secret: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    validate_pin_format(pin)?;
    let mut combined = Vec::with_capacity(pin.len() + device_secret.len());
    combined.extend_from_slice(pin.as_bytes());
    combined.extend_from_slice(device_secret);
    let zeroizing_combined = Zeroizing::new(combined);

    let params = Argon2Params::new(65536, 3, 1, Some(32))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Argon2Algorithm::Argon2id, Argon2Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(&*zeroizing_combined, salt, &mut key)
        .map_err(|e| format!("Argon2 hash failed: {}", e))?;
    Ok(Zeroizing::new(key))
}


pub fn encrypt_data(key: &[u8], nonce: &[u8; 24], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let xnonce = XNonce::from(*nonce);
    let payload = Payload {
        msg: plaintext,
        aad,
    };
    cipher
        .encrypt(&xnonce, payload)
        .map_err(|e| format!("Encryption failed: {}", e))
}

pub fn decrypt_data(key: &[u8], nonce: &[u8; 24], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let xnonce = XNonce::from(*nonce);
    let payload = Payload {
        msg: ciphertext,
        aad,
    };
    cipher
        .decrypt(&xnonce, payload)
        .map_err(|_| "Decryption failed (incorrect password or corrupted data)".to_string())
}

// ============================================================================
// 6. Validation, Canonicalization & TOTP Utilities
// ============================================================================

pub fn normalize_secret(secret: &str) -> String {
    secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase()
}

pub fn urlencoding_decode(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = input.bytes().peekable();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                let hex_str = [h1, h2];
                if let Ok(s) = std::str::from_utf8(&hex_str) {
                    if let Ok(val) = u8::from_str_radix(s, 16) {
                        bytes.push(val);
                        continue;
                    }
                }
                bytes.push(b'%');
                bytes.push(h1);
                bytes.push(h2);
            } else {
                bytes.push(b'%');
                if let Some(h1) = h1 {
                    bytes.push(h1);
                }
            }
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn parse_algorithm(alg: &str) -> Result<totp_rs::Algorithm, String> {
    match alg.trim().to_uppercase().as_str() {
        "SHA1" | "SHA-1" => Ok(totp_rs::Algorithm::SHA1),
        "SHA256" | "SHA-256" => Ok(totp_rs::Algorithm::SHA256),
        "SHA512" | "SHA-512" => Ok(totp_rs::Algorithm::SHA512),
        other => Err(format!(
            "Unsupported algorithm '{}'. Only SHA1, SHA256, and SHA512 are allowed.",
            other
        )),
    }
}

pub fn validate_and_canonicalize_payload(payload: &mut TwofaAccountSecretPayload) -> Result<(), String> {
    payload.secret = normalize_secret(&payload.secret);
    if payload.secret.is_empty() {
        return Err("Secret cannot be empty".to_string());
    }

    let secret_obj = totp_rs::Secret::try_from_base32(&payload.secret)
        .map_err(|e| format!("Invalid Base32 secret: {}", e))?;
    let secret_bytes = secret_obj.as_bytes().to_vec();
    if secret_bytes.is_empty() {
        return Err("Secret must decode to at least 1 byte".to_string());
    }

    let algo = parse_algorithm(&payload.algorithm)?;
    payload.algorithm = match algo {
        totp_rs::Algorithm::SHA1 => "SHA1".to_string(),
        totp_rs::Algorithm::SHA256 => "SHA256".to_string(),
        totp_rs::Algorithm::SHA512 => "SHA512".to_string(),
        _ => "SHA1".to_string(),
    };

    if payload.digits != 6 && payload.digits != 7 && payload.digits != 8 {
        return Err(format!("Invalid digits: {}. Only 6, 7, or 8 digits are supported.", payload.digits));
    }

    if payload.period == 0 || payload.period > 3600 {
        return Err(format!("Invalid period: {}. Period must be between 1 and 3600 seconds.", payload.period));
    }

    payload.issuer = payload.issuer.trim().to_string();
    payload.account = payload.account.trim().to_string();
    if payload.issuer.is_empty() && payload.account.is_empty() {
        return Err("Account must have at least an issuer name or an account name".to_string());
    }

    #[allow(deprecated)]
    let _ = totp_rs::Totp::new_unchecked(
        algo,
        payload.digits as usize,
        1,
        payload.period as u64,
        secret_bytes,
        None,
        "".to_string(),
    );

    Ok(())
}

pub fn calculate_totp(
    secret: &str,
    algorithm: &str,
    digits: u32,
    period: u32,
    timestamp: u64,
) -> Result<String, String> {
    if !(6..=8).contains(&digits) {
        return Err(format!("Invalid digits: {}. Only 6, 7, or 8 digits are supported.", digits));
    }
    if !(1..=3600).contains(&period) {
        return Err(format!("Invalid period: {}. Period must be between 1 and 3600 seconds.", period));
    }
    let clean_secret = normalize_secret(secret);
    if clean_secret.is_empty() {
        return Err("Secret cannot be empty".to_string());
    }
    let algo = parse_algorithm(algorithm)?;
    let secret_obj = totp_rs::Secret::try_from_base32(&clean_secret)
        .map_err(|e| format!("Invalid Base32 secret: {}", e))?;
    let secret_bytes = secret_obj.as_bytes().to_vec();

    #[allow(deprecated)]
    let totp = totp_rs::Totp::new_unchecked(
        algo,
        digits as usize,
        1,
        period as u64,
        secret_bytes,
        None,
        "".to_string(),
    );

    Ok(totp.generate(timestamp).to_string())
}

pub fn parse_otpauth_uri(uri: &str) -> Result<TwofaAccountSecretPayload, String> {
    let trimmed = uri.trim();
    if !trimmed.starts_with("otpauth://") {
        return Err("Invalid URI: must start with 'otpauth://'".to_string());
    }

    let without_prefix = &trimmed["otpauth://".len()..];
    let type_end = without_prefix.find('/').ok_or("Invalid URI: missing type separator '/'")?;
    let auth_type = &without_prefix[..type_end];

    if auth_type.eq_ignore_ascii_case("hotp") {
        return Err("HOTP (counter-based) tokens are not supported. Only TOTP (time-based) tokens are supported.".to_string());
    }
    if !auth_type.eq_ignore_ascii_case("totp") {
        return Err(format!("Unsupported authentication type: '{}'. Only 'totp' is supported.", auth_type));
    }

    let remainder = &without_prefix[type_end + 1..];
    let (label_part, query_part) = match remainder.find('?') {
        Some(idx) => (&remainder[..idx], &remainder[idx + 1..]),
        None => (remainder, ""),
    };

    let decoded_label = urlencoding_decode(label_part);
    let (label_issuer, label_account) = match decoded_label.find(':') {
        Some(idx) => (
            decoded_label[..idx].trim().to_string(),
            decoded_label[idx + 1..].trim().to_string(),
        ),
        None => ("".to_string(), decoded_label.trim().to_string()),
    };

    let mut secret: Option<String> = None;
    let mut param_issuer: Option<String> = None;
    let mut param_algorithm: Option<String> = None;
    let mut param_digits: Option<u32> = None;
    let mut param_period: Option<u32> = None;

    for param in query_part.split('&') {
        if param.is_empty() {
            continue;
        }
        let (key, val) = match param.find('=') {
            Some(idx) => (&param[..idx], &param[idx + 1..]),
            None => (param, ""),
        };
        let decoded_val = urlencoding_decode(val);
        match key.to_lowercase().as_str() {
            "secret" => {
                secret = Some(decoded_val);
            }
            "issuer" => {
                param_issuer = Some(decoded_val);
            }
            "algorithm" => {
                let alg_val = decoded_val.trim().to_uppercase();
                if alg_val != "SHA1" && alg_val != "SHA256" && alg_val != "SHA512" {
                    return Err(format!("Invalid algorithm parameter in URI: '{}'. Supported: SHA1, SHA256, SHA512.", decoded_val));
                }
                param_algorithm = Some(alg_val);
            }
            "digits" => {
                let d = decoded_val.trim().parse::<u32>().map_err(|_| {
                    format!("Invalid digits parameter in URI: '{}'. Must be an integer.", decoded_val)
                })?;
                if d != 6 && d != 7 && d != 8 {
                    return Err(format!("Invalid digits parameter in URI: {}. Must be 6, 7, or 8.", d));
                }
                param_digits = Some(d);
            }
            "period" => {
                let p = decoded_val.trim().parse::<u32>().map_err(|_| {
                    format!("Invalid period parameter in URI: '{}'. Must be a positive integer.", decoded_val)
                })?;
                if p == 0 || p > 3600 {
                    return Err(format!("Invalid period parameter in URI: {}. Must be between 1 and 3600.", p));
                }
                param_period = Some(p);
            }
            _ => {}
        }
    }

    let secret = secret.ok_or("URI is missing required 'secret' parameter")?;
    let issuer = param_issuer.unwrap_or(label_issuer);
    let account = label_account;

    let algorithm = param_algorithm.unwrap_or_else(|| "SHA1".to_string());
    let digits = param_digits.unwrap_or(6);
    let period = param_period.unwrap_or(30);

    let mut payload = TwofaAccountSecretPayload {
        issuer,
        account,
        secret,
        algorithm,
        digits,
        period,
        notes: String::new(),
        icon: None,
    };

    validate_and_canonicalize_payload(&mut payload)?;
    Ok(payload)
}

pub fn build_otpauth_uri(payload: &TwofaAccountSecretPayload) -> Result<String, String> {
    let clean_secret = normalize_secret(&payload.secret);
    let algo = parse_algorithm(&payload.algorithm)?;
    let secret_obj = totp_rs::Secret::try_from_base32(&clean_secret)
        .map_err(|e| format!("Invalid Base32 secret: {}", e))?;
    let secret_bytes = secret_obj.as_bytes().to_vec();

    let issuer_opt = if payload.issuer.trim().is_empty() {
        None
    } else {
        Some(payload.issuer.trim().to_string())
    };

    #[allow(deprecated)]
    let totp = totp_rs::Totp::new_unchecked(
        algo,
        payload.digits as usize,
        1,
        payload.period as u64,
        secret_bytes,
        issuer_opt,
        payload.account.trim().to_string(),
    );

    totp.to_url().map_err(|e| format!("Failed to generate TOTP URI: {:?}", e))
}

pub fn generate_qr_png_bytes(content: &str) -> Result<Vec<u8>, String> {
    let code = qrcode::QrCode::new(content.as_bytes())
        .map_err(|e| format!("Failed to generate QR code: {}", e))?;
    let image = code.render::<image::Rgb<u8>>().build();
    let mut cursor = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    Ok(cursor.into_inner())
}

pub fn generate_qr_data_url(content: &str) -> Result<String, String> {
    let png_bytes = generate_qr_png_bytes(content)?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(png_bytes)))
}

pub fn scan_qrs_from_luma(luma: &image::GrayImage) -> Vec<String> {
    let mut img = rqrr::PreparedImage::prepare(luma.clone());
    let grids = img.detect_grids();
    let mut results = Vec::new();
    for grid in grids {
        let mut content_bytes = Vec::new();
        if grid.decode_to(&mut content_bytes).is_ok() {
            if let Ok(content) = String::from_utf8(content_bytes) {
                results.push(content);
            }
        }
    }
    results
}

pub fn scan_totp_from_image_bytes(bytes: &[u8]) -> Result<Vec<TwofaAccountSecretPayload>, String> {
    // 1. Enforce max file size: 20 MiB
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Image file size exceeds maximum allowed limit of 20 MiB".to_string());
    }

    // 2. Enforce decoder allocation and dimension limits (4096 x 4096)
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image format: {}", e))?;

    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(4096 * 4096 * 4); // 64 MiB max allocation
    reader.limits(limits);

    let img = reader
        .decode()
        .map_err(|e| format!("Failed to decode image (must be valid PNG, JPEG, or WebP <= 4096x4096): {}", e))?;

    let luma = img.to_luma8();
    let uris = scan_qrs_from_luma(&luma);
    if uris.is_empty() {
        return Err("No QR codes detected in the provided image".to_string());
    }

    let mut payloads = Vec::new();
    for uri in uris {
        if let Ok(p) = parse_otpauth_uri(&uri) {
            payloads.push(p);
        }
    }

    if payloads.is_empty() {
        return Err("QR codes found, but none contained valid TOTP configuration URIs".to_string());
    }

    Ok(payloads)
}

// ============================================================================
// 7. Database Schema & Migration
// ============================================================================

pub fn init_twofa_schema(conn: &mut SqliteConnection) -> Result<(), String> {
    conn.batch_execute(
        "CREATE TABLE IF NOT EXISTS twofa_vault_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL DEFAULT 1,
            kdf_salt BLOB NOT NULL,
            kdf_memory_kib INTEGER NOT NULL DEFAULT 65536,
            kdf_iterations INTEGER NOT NULL DEFAULT 3,
            kdf_parallelism INTEGER NOT NULL DEFAULT 1,
            encrypted_data_key BLOB NOT NULL,
            data_key_nonce BLOB NOT NULL,
            lock_time_setting TEXT NOT NULL DEFAULT 'FiveMinutes',
            lock_on_screen_lock INTEGER NOT NULL DEFAULT 1,
            hide_token_setting TEXT NOT NULL DEFAULT 'Never',
            clear_clipboard_setting TEXT NOT NULL DEFAULT 'ThirtySeconds',
            sort_order_setting TEXT NOT NULL DEFAULT 'ISSUER_ASC',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS twofa_accounts (
            id TEXT PRIMARY KEY NOT NULL,
            encrypted_payload BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS twofa_account_projects (
            account_id TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            PRIMARY KEY(account_id, project_id),
            FOREIGN KEY(account_id) REFERENCES twofa_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS twofa_unlock_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            vault_uuid TEXT NOT NULL,
            format_version INTEGER NOT NULL DEFAULT 1,
            lock_enabled INTEGER NOT NULL DEFAULT 1,
            credential_generation INTEGER NOT NULL DEFAULT 1,
            auto_credential_id TEXT,
            pin_credential_id TEXT,
            pin_salt BLOB,
            pin_nonce BLOB,
            pin_wrapped_key BLOB,
            pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
            pending_operation TEXT,
            pending_credential_id TEXT,
            pending_journal TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS twofa_setup_journal (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            vault_uuid TEXT NOT NULL,
            auto_credential_id TEXT,
            pin_credential_id TEXT,
            created_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to create 2FA tables: {}", e))?;

    let _ = conn.batch_execute("ALTER TABLE twofa_unlock_config ADD COLUMN pending_journal TEXT;");

    // Migrate settings safely & idempotently without touching encrypted accounts
    migrate_twofa_settings(conn)?;
    migrate_unlock_config(conn)?;

    Ok(())
}

#[derive(QueryableByName, Debug, Clone)]
pub struct SetupJournalRow {
    #[diesel(sql_type = Integer)]
    pub id: i32,
    #[diesel(sql_type = Text)]
    pub vault_uuid: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub auto_credential_id: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub pin_credential_id: Option<String>,
    #[diesel(sql_type = Text)]
    pub created_at: String,
}

pub fn get_setup_journal(conn: &mut SqliteConnection) -> Result<Option<SetupJournalRow>, String> {
    sql_query("SELECT id, vault_uuid, auto_credential_id, pin_credential_id, created_at FROM twofa_setup_journal WHERE id = 1")
        .load::<SetupJournalRow>(conn)
        .map(|mut rows| rows.pop())
        .map_err(|e| format!("Failed to read setup journal: {}", e))
}

pub fn has_setup_journal(conn: &mut SqliteConnection) -> bool {
    get_setup_journal(conn).ok().flatten().is_some()
}

pub fn cleanup_setup_journal(
    conn: &mut SqliteConnection,
    credential_store: &dyn CredentialStore,
) -> Result<(), String> {
    if get_vault_metadata(conn)?.is_some() {
        let _ = sql_query("DELETE FROM twofa_setup_journal WHERE id = 1").execute(conn);
        return Ok(());
    }

    if let Some(row) = get_setup_journal(conn)? {
        let mut to_delete = Vec::new();
        if let Some(ref aid) = row.auto_credential_id {
            if is_valid_vault_credential_id(&row.vault_uuid, aid) {
                to_delete.push(aid.clone());
            }
        }
        if let Some(ref pid) = row.pin_credential_id {
            if is_valid_vault_credential_id(&row.vault_uuid, pid) {
                to_delete.push(pid.clone());
            }
        }

        for cid in to_delete {
            match credential_store.delete_password("projects-runner-twofa", &cid) {
                Ok(()) => {}
                Err(CredentialStoreError::NotFound) => {}
                Err(e) => {
                    return Err(format!("CREDENTIAL_STORE_UNAVAILABLE: Failed to delete setup credential: {}", e));
                }
            }
        }

        sql_query("DELETE FROM twofa_setup_journal WHERE id = 1")
            .execute(conn)
            .map_err(|e| format!("Failed to delete setup journal: {}", e))?;
    }

    Ok(())
}

pub fn migrate_unlock_config(conn: &mut SqliteConnection) -> Result<(), String> {
    if get_vault_metadata(conn)?.is_some() {
        if get_unlock_config(conn)?.is_none() {
            let vault_uuid = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            sql_query(
                "INSERT INTO twofa_unlock_config (
                    id, vault_uuid, format_version, lock_enabled, credential_generation,
                    auto_credential_id, pin_credential_id, pin_salt, pin_nonce, pin_wrapped_key,
                    pin_failed_attempts, pending_operation, pending_credential_id, pending_journal, updated_at
                ) VALUES (1, ?, 1, 1, 1, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?)"
            )
            .bind::<Text, _>(&vault_uuid)
            .bind::<Text, _>(&now)
            .execute(conn)
            .map_err(|e| format!("Failed to initialize unlock config for existing vault: {}", e))?;
        }
    }
    Ok(())
}

pub fn migrate_twofa_settings(conn: &mut SqliteConnection) -> Result<(), String> {
    if let Some(row) = get_vault_metadata(conn)? {
        let lock_time = LockTimeSetting::from_legacy_or_str(&row.lock_time_setting);
        let hide_token = HideTokenSetting::from_legacy_or_str(&row.hide_token_setting);
        let clear_clip = ClearClipboardSetting::from_legacy_or_str(&row.clear_clipboard_setting);
        let sort_order = SortOrderSetting::from_legacy_or_str(&row.sort_order_setting);

        if row.lock_time_setting != lock_time.as_str()
            || row.hide_token_setting != hide_token.as_str()
            || row.clear_clipboard_setting != clear_clip.as_str()
            || row.sort_order_setting != sort_order.as_str()
        {
            let now = Utc::now().to_rfc3339();
            sql_query(
                "UPDATE twofa_vault_metadata SET
                    lock_time_setting = ?,
                    hide_token_setting = ?,
                    clear_clipboard_setting = ?,
                    sort_order_setting = ?,
                    updated_at = ?
                WHERE id = 1"
            )
            .bind::<Text, _>(lock_time.as_str())
            .bind::<Text, _>(hide_token.as_str())
            .bind::<Text, _>(clear_clip.as_str())
            .bind::<Text, _>(sort_order.as_str())
            .bind::<Text, _>(&now)
            .execute(conn)
            .map_err(|e| format!("Failed to migrate twofa settings: {}", e))?;
        }
    }
    Ok(())
}

#[derive(QueryableByName, Debug, Clone)]
pub struct UnlockConfigRow {
    #[diesel(sql_type = Integer)]
    pub id: i32,
    #[diesel(sql_type = Text)]
    pub vault_uuid: String,
    #[diesel(sql_type = Integer)]
    pub format_version: i32,
    #[diesel(sql_type = Integer)]
    pub lock_enabled: i32,
    #[diesel(sql_type = Integer)]
    pub credential_generation: i32,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub auto_credential_id: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub pin_credential_id: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Binary>)]
    pub pin_salt: Option<Vec<u8>>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Binary>)]
    pub pin_nonce: Option<Vec<u8>>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Binary>)]
    pub pin_wrapped_key: Option<Vec<u8>>,
    #[diesel(sql_type = Integer)]
    pub pin_failed_attempts: i32,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub pending_operation: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub pending_credential_id: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    pub pending_journal: Option<String>,
    #[diesel(sql_type = Text)]
    pub updated_at: String,
}

impl UnlockConfigRow {
    pub fn is_pin_enabled(&self) -> bool {
        self.pin_salt.as_ref().map_or(false, |s| s.len() == 16)
            && self.pin_nonce.as_ref().map_or(false, |n| n.len() == 24)
            && self.pin_wrapped_key.as_ref().map_or(false, |k| !k.is_empty())
            && self.pin_credential_id.is_some()
    }
}

pub fn get_unlock_config(conn: &mut SqliteConnection) -> Result<Option<UnlockConfigRow>, String> {
    sql_query("SELECT * FROM twofa_unlock_config WHERE id = 1")
        .load::<UnlockConfigRow>(conn)
        .map(|mut rows| rows.pop())
        .map_err(|e| format!("Failed to read unlock config: {}", e))
}

#[derive(QueryableByName, Debug)]
pub struct VaultMetadataRow {
    #[diesel(sql_type = Integer)]
    pub id: i32,
    #[diesel(sql_type = Integer)]
    pub version: i32,
    #[diesel(sql_type = Binary)]
    pub kdf_salt: Vec<u8>,
    #[diesel(sql_type = Integer)]
    pub kdf_memory_kib: i32,
    #[diesel(sql_type = Integer)]
    pub kdf_iterations: i32,
    #[diesel(sql_type = Integer)]
    pub kdf_parallelism: i32,
    #[diesel(sql_type = Binary)]
    pub encrypted_data_key: Vec<u8>,
    #[diesel(sql_type = Binary)]
    pub data_key_nonce: Vec<u8>,
    #[diesel(sql_type = Text)]
    pub lock_time_setting: String,
    #[diesel(sql_type = Integer)]
    pub lock_on_screen_lock: i32,
    #[diesel(sql_type = Text)]
    pub hide_token_setting: String,
    #[diesel(sql_type = Text)]
    pub clear_clipboard_setting: String,
    #[diesel(sql_type = Text)]
    pub sort_order_setting: String,
    #[diesel(sql_type = Text)]
    pub created_at: String,
    #[diesel(sql_type = Text)]
    pub updated_at: String,
}

#[derive(QueryableByName, Debug)]
pub struct AccountRow {
    #[diesel(sql_type = Text)]
    pub id: String,
    #[diesel(sql_type = Binary)]
    pub encrypted_payload: Vec<u8>,
    #[diesel(sql_type = Binary)]
    pub nonce: Vec<u8>,
    #[diesel(sql_type = Text)]
    pub created_at: String,
    #[diesel(sql_type = Text)]
    pub updated_at: String,
}

#[derive(QueryableByName, Debug)]
pub struct AccountProjectRow {
    #[diesel(sql_type = Text)]
    pub account_id: String,
    #[diesel(sql_type = Integer)]
    pub project_id: i32,
}

#[derive(QueryableByName, Debug)]
pub struct CountRow {
    #[diesel(sql_type = Integer)]
    pub count: i32,
}

#[derive(QueryableByName, Debug)]
pub struct ProjectNameRow {
    #[diesel(sql_type = Integer)]
    pub id: i32,
    #[diesel(sql_type = Text)]
    pub name: String,
}

pub fn get_vault_metadata(conn: &mut SqliteConnection) -> Result<Option<VaultMetadataRow>, String> {
    sql_query("SELECT * FROM twofa_vault_metadata WHERE id = 1")
        .load::<VaultMetadataRow>(conn)
        .map(|mut rows| rows.pop())
        .map_err(|e| format!("Failed to read vault metadata: {}", e))
}

pub fn get_vault_status(
    conn: &mut SqliteConnection,
    state: &TwofaVaultState,
) -> Result<TwofaVaultStatus, String> {
    let metadata_opt = get_vault_metadata(conn)?;
    let unlock_config_opt = get_unlock_config(conn)?;
    let is_initialized = metadata_opt.is_some();
    let is_locked = !state.is_unlocked();

    let account_count: i32 = sql_query("SELECT COUNT(*) as count FROM twofa_accounts")
        .get_result::<CountRow>(conn)
        .map(|r| r.count)
        .unwrap_or(0);

    let unassigned_count: i32 = sql_query(
        "SELECT COUNT(*) as count FROM twofa_accounts WHERE id NOT IN (SELECT account_id FROM twofa_account_projects)"
    )
    .get_result::<CountRow>(conn)
    .map(|r| r.count)
    .unwrap_or(0);

    let (lock_time_setting, lock_on_screen_lock, hide_token_setting, clear_clipboard_setting, sort_order_setting) =
        if let Some(m) = metadata_opt {
            (
                LockTimeSetting::from_legacy_or_str(&m.lock_time_setting),
                m.lock_on_screen_lock != 0,
                HideTokenSetting::from_legacy_or_str(&m.hide_token_setting),
                ClearClipboardSetting::from_legacy_or_str(&m.clear_clipboard_setting),
                SortOrderSetting::from_legacy_or_str(&m.sort_order_setting),
            )
        } else {
            (
                state.settings.lock_time_setting,
                state.settings.lock_on_screen_lock,
                state.settings.hide_token_setting,
                state.settings.clear_clipboard_setting,
                state.settings.sort_order_setting,
            )
        };

    let (lock_enabled, pin_enabled, pin_failed_attempts, is_pin_blocked, recovery_required) =
        if let Some(ref u) = unlock_config_opt {
            let is_pin = u.is_pin_enabled();
            let attempts = u.pin_failed_attempts.max(0) as u32;
            let rec_req = u.pending_operation.is_some() || u.pending_journal.is_some();
            (u.lock_enabled != 0, is_pin, attempts, attempts >= 5, rec_req)
        } else {
            (true, false, 0, false, false)
        };

    let has_vault = is_initialized;
    let is_unlocked = !is_locked && is_initialized;
    let setup_cleanup_required = !is_initialized && has_setup_journal(conn);
    Ok(TwofaVaultStatus {
        is_initialized,
        is_locked,
        has_vault,
        is_unlocked,
        session_id: state.session_id.clone(),
        revision: state.revision,
        lock_enabled,
        pin_enabled,
        pin_failed_attempts,
        pin_max_attempts: 5,
        is_pin_blocked,
        recovery_required,
        setup_cleanup_required,
        credential_store_status: state.credential_store_status,
        lock_time_setting,
        lock_on_screen_lock,
        hide_token_setting,
        clear_clipboard_setting,
        sort_order_setting,
        account_count: account_count as usize,
        unassigned_count: unassigned_count as usize,
        platform_capabilities: state.platform_capabilities.clone(),
    })
}

pub fn get_unlocked_data_key(state: &TwofaVaultState) -> Result<[u8; 32], String> {
    state
        .master_data_key
        .as_ref()
        .map(|k| **k)
        .ok_or_else(|| "2FA Vault is locked".to_string())
}

// ============================================================================
// 9. Account CRUD & Query Operations
// ============================================================================

pub fn list_accounts(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    project_id: Option<i64>,
    unassigned_only: bool,
    search: Option<String>,
    expected_session_id: &str,
) -> Result<Vec<TwofaAccountSummary>, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;

    let rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
        .load::<AccountRow>(conn)
        .map_err(|e| format!("Failed to read accounts: {}", e))?;

    let links = sql_query("SELECT account_id, project_id FROM twofa_account_projects")
        .load::<AccountProjectRow>(conn)
        .map_err(|e| format!("Failed to read account links: {}", e))?;

    let mut project_map: HashMap<String, Vec<i64>> = HashMap::new();
    for link in links {
        project_map.entry(link.account_id).or_default().push(link.project_id as i64);
    }

    let search_lower = search.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());

    let mut result = Vec::new();
    for row in rows {
        let pids = project_map.remove(&row.id).unwrap_or_default();

        if unassigned_only && !pids.is_empty() {
            continue;
        }
        if let Some(pid) = project_id {
            if !pids.contains(&pid) {
                continue;
            }
        }

        let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => {
                result.push(TwofaAccountSummary {
                    id: row.id,
                    issuer: "[Corrupted]".to_string(),
                    account: "[Corrupted Nonce]".to_string(),
                    algorithm: "SHA1".to_string(),
                    digits: 6,
                    period: 30,
                    notes: String::new(),
                    icon: None,
                    project_ids: pids,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    is_valid: false,
                    validation_error: Some("Invalid encryption nonce in storage".to_string()),
                });
                continue;
            }
        };

        let aad = format!("pr_twofa_acc:{}:v1", row.id);
        let decrypted_bytes = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                result.push(TwofaAccountSummary {
                    id: row.id,
                    issuer: "[Corrupted]".to_string(),
                    account: "[Decryption Failed]".to_string(),
                    algorithm: "SHA1".to_string(),
                    digits: 6,
                    period: 30,
                    notes: String::new(),
                    icon: None,
                    project_ids: pids,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    is_valid: false,
                    validation_error: Some("Decryption failed for account payload".to_string()),
                });
                continue;
            }
        };

        let payload: TwofaAccountSecretPayload = match serde_json::from_slice(&decrypted_bytes) {
            Ok(p) => p,
            Err(_) => {
                result.push(TwofaAccountSummary {
                    id: row.id,
                    issuer: "[Corrupted]".to_string(),
                    account: "[Malformed Payload]".to_string(),
                    algorithm: "SHA1".to_string(),
                    digits: 6,
                    period: 30,
                    notes: String::new(),
                    icon: None,
                    project_ids: pids,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    is_valid: false,
                    validation_error: Some("Account payload could not be parsed".to_string()),
                });
                continue;
            }
        };

        // Check search filter
        if let Some(ref q) = search_lower {
            let match_issuer = payload.issuer.to_lowercase().contains(q);
            let match_account = payload.account.to_lowercase().contains(q);
            let match_notes = payload.notes.to_lowercase().contains(q);
            if !match_issuer && !match_account && !match_notes {
                continue;
            }
        }

        let mut check_payload = payload.clone();
        let (is_valid, validation_error) = match validate_and_canonicalize_payload(&mut check_payload) {
            Ok(_) => (true, None),
            Err(e) => (false, Some(e)),
        };

        result.push(TwofaAccountSummary {
            id: row.id,
            issuer: payload.issuer,
            account: payload.account,
            algorithm: payload.algorithm,
            digits: payload.digits,
            period: payload.period,
            notes: payload.notes,
            icon: payload.icon,
            project_ids: pids,
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_valid,
            validation_error,
        });
    }

    // Apply sorting
    match state.settings.sort_order_setting {
        SortOrderSetting::IssuerAsc => {
            result.sort_by(|a, b| {
                a.issuer.to_lowercase().cmp(&b.issuer.to_lowercase())
                    .then_with(|| a.account.to_lowercase().cmp(&b.account.to_lowercase()))
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        SortOrderSetting::IssuerDesc => {
            result.sort_by(|a, b| {
                b.issuer.to_lowercase().cmp(&a.issuer.to_lowercase())
                    .then_with(|| b.account.to_lowercase().cmp(&a.account.to_lowercase()))
                    .then_with(|| b.id.cmp(&a.id))
            });
        }
        SortOrderSetting::CreatedAsc => {
            result.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
        }
        SortOrderSetting::CreatedDesc => {
            result.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.id.cmp(&a.id)));
        }
    }

    Ok(result)
}

pub fn get_account_payload_internal(
    conn: &mut SqliteConnection,
    data_key: &[u8; 32],
    account_id: &str,
) -> Result<TwofaAccountSecretPayload, String> {
    let row = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts WHERE id = ?")
        .bind::<Text, _>(account_id)
        .get_result::<AccountRow>(conn)
        .map_err(|_| format!("Account '{}' not found", account_id))?;

    let nonce_arr: [u8; 24] = row
        .nonce
        .as_slice()
        .try_into()
        .map_err(|_| "Corrupted account nonce".to_string())?;

    let aad = format!("pr_twofa_acc:{}:v1", row.id);
    let decrypted = decrypt_data(data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes())?;

    let payload: TwofaAccountSecretPayload = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Corrupted account payload: {}", e))?;

    Ok(payload)
}

pub fn create_account(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    input: TwofaAccountInput,
    expected_session_id: &str,
) -> Result<TwofaAccountSummary, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();

    let secret_raw = input.secret.ok_or("Secret is required for new accounts")?;
    let mut payload = TwofaAccountSecretPayload {
        issuer: input.issuer,
        account: input.account,
        secret: secret_raw,
        algorithm: input.algorithm.unwrap_or_else(|| "SHA1".to_string()),
        digits: input.digits.unwrap_or(6),
        period: input.period.unwrap_or(30),
        notes: input.notes.unwrap_or_default(),
        icon: input.icon,
    };

    validate_and_canonicalize_payload(&mut payload)?;

    let account_id = Uuid::new_v4().to_string();
    let nonce = generate_random_bytes::<24>();
    let plaintext = serde_json::to_vec(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let aad = format!("pr_twofa_acc:{}:v1", account_id);
    let ciphertext = encrypt_data(&data_key, &nonce, &plaintext, aad.as_bytes())?;

    let now = Utc::now().to_rfc3339();
    let project_ids = input.project_ids.unwrap_or_default();

    with_transaction(conn, |c| {
        sql_query("INSERT INTO twofa_accounts (id, encrypted_payload, nonce, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind::<Text, _>(&account_id)
            .bind::<Binary, _>(&ciphertext)
            .bind::<Binary, _>(&nonce)
            .bind::<Text, _>(&now)
            .bind::<Text, _>(&now)
            .execute(c)
            .map_err(|e| format!("Failed to insert account: {}", e))?;

        for pid in &project_ids {
            sql_query("INSERT INTO twofa_account_projects (account_id, project_id) VALUES (?, ?)")
                .bind::<Text, _>(&account_id)
                .bind::<Integer, _>(*pid as i32)
                .execute(c)
                .map_err(|e| format!("Failed to associate project: {}", e))?;
        }

        Ok(())
    })?;

    state.revision += 1;

    Ok(TwofaAccountSummary {
        id: account_id,
        issuer: payload.issuer,
        account: payload.account,
        algorithm: payload.algorithm,
        digits: payload.digits,
        period: payload.period,
        notes: payload.notes,
        icon: payload.icon,
        project_ids,
        created_at: now.clone(),
        updated_at: now,
        is_valid: true,
        validation_error: None,
    })
}

pub fn update_account(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    account_id: &str,
    input: TwofaAccountInput,
    expected_session_id: &str,
) -> Result<TwofaAccountSummary, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();

    let existing = get_account_payload_internal(conn, &data_key, account_id)?;

    let new_secret = match input.secret {
        Some(s) if !s.trim().is_empty() => s,
        _ => existing.secret,
    };
    let new_algorithm = input.algorithm.unwrap_or(existing.algorithm);
    let new_digits = input.digits.unwrap_or(existing.digits);
    let new_period = input.period.unwrap_or(existing.period);
    // Notes: Some("") clears notes, None preserves existing notes
    let new_notes = input.notes.unwrap_or(existing.notes);
    let new_icon = input.icon.or(existing.icon);

    let mut payload = TwofaAccountSecretPayload {
        issuer: input.issuer,
        account: input.account,
        secret: new_secret,
        algorithm: new_algorithm,
        digits: new_digits,
        period: new_period,
        notes: new_notes,
        icon: new_icon,
    };

    validate_and_canonicalize_payload(&mut payload)?;

    let nonce = generate_random_bytes::<24>();
    let plaintext = serde_json::to_vec(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let aad = format!("pr_twofa_acc:{}:v1", account_id);
    let ciphertext = encrypt_data(&data_key, &nonce, &plaintext, aad.as_bytes())?;

    let now = Utc::now().to_rfc3339();

    with_transaction(conn, |c| {
        sql_query("UPDATE twofa_accounts SET encrypted_payload = ?, nonce = ?, updated_at = ? WHERE id = ?")
            .bind::<Binary, _>(&ciphertext)
            .bind::<Binary, _>(&nonce)
            .bind::<Text, _>(&now)
            .bind::<Text, _>(account_id)
            .execute(c)
            .map_err(|e| format!("Failed to update account: {}", e))?;

        if let Some(pids) = &input.project_ids {
            sql_query("DELETE FROM twofa_account_projects WHERE account_id = ?")
                .bind::<Text, _>(account_id)
                .execute(c)
                .map_err(|e| format!("Failed to clear old project links: {}", e))?;

            for pid in pids {
                sql_query("INSERT INTO twofa_account_projects (account_id, project_id) VALUES (?, ?)")
                    .bind::<Text, _>(account_id)
                    .bind::<Integer, _>(*pid as i32)
                    .execute(c)
                    .map_err(|e| format!("Failed to update project links: {}", e))?;
            }
        }
        Ok(())
    })?;

    let current_links = sql_query("SELECT project_id FROM twofa_account_projects WHERE account_id = ?")
        .bind::<Text, _>(account_id)
        .load::<AccountProjectRow>(conn)
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.project_id as i64)
        .collect();

    state.revision += 1;

    Ok(TwofaAccountSummary {
        id: account_id.to_string(),
        issuer: payload.issuer,
        account: payload.account,
        algorithm: payload.algorithm,
        digits: payload.digits,
        period: payload.period,
        notes: payload.notes,
        icon: payload.icon,
        project_ids: current_links,
        created_at: now.clone(),
        updated_at: now,
        is_valid: true,
        validation_error: None,
    })
}

pub fn delete_account(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    account_id: &str,
    expected_session_id: &str,
) -> Result<(), String> {
    state.validate_session(expected_session_id)?;
    state.touch_activity();

    with_transaction(conn, |c| {
        sql_query("DELETE FROM twofa_account_projects WHERE account_id = ?")
            .bind::<Text, _>(account_id)
            .execute(c)
            .map_err(|e| format!("Failed to remove project links: {}", e))?;

        sql_query("DELETE FROM twofa_accounts WHERE id = ?")
            .bind::<Text, _>(account_id)
            .execute(c)
            .map_err(|e| format!("Failed to delete account: {}", e))?;

        Ok(())
    })?;

    state.revision += 1;
    Ok(())
}

// ============================================================================
// 10. Batch Codes & Native Clipboard Copy
// ============================================================================

pub fn get_twofa_codes(
    conn: &mut SqliteConnection,
    state: &TwofaVaultState,
    account_ids: Option<Vec<String>>,
    expected_session_id: &str,
) -> Result<TwofaCodeBatch, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;

    let now_ts = Utc::now().timestamp() as u64;

    let rows = match account_ids {
        Some(ids) if !ids.is_empty() => {
            let mut matched = Vec::new();
            for id in ids {
                if let Ok(row) = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts WHERE id = ?")
                    .bind::<Text, _>(&id)
                    .get_result::<AccountRow>(conn)
                {
                    matched.push(row);
                }
            }
            matched
        }
        _ => sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
            .load::<AccountRow>(conn)
            .map_err(|e| format!("Failed to load accounts: {}", e))?,
    };

    let mut codes = Vec::new();
    for row in rows {
        let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => {
                codes.push(TwofaCodeItem {
                    account_id: row.id,
                    code: String::new(),
                    period: 30,
                    valid_until: now_ts + 30,
                    remaining_seconds: 0,
                    is_valid: false,
                    error: Some("Corrupted account nonce".to_string()),
                });
                continue;
            }
        };

        let aad = format!("pr_twofa_acc:{}:v1", row.id);
        let decrypted = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                codes.push(TwofaCodeItem {
                    account_id: row.id,
                    code: String::new(),
                    period: 30,
                    valid_until: now_ts + 30,
                    remaining_seconds: 0,
                    is_valid: false,
                    error: Some("Decryption failed".to_string()),
                });
                continue;
            }
        };

        let payload: TwofaAccountSecretPayload = match serde_json::from_slice(&decrypted) {
            Ok(p) => p,
            Err(_) => {
                codes.push(TwofaCodeItem {
                    account_id: row.id,
                    code: String::new(),
                    period: 30,
                    valid_until: now_ts + 30,
                    remaining_seconds: 0,
                    is_valid: false,
                    error: Some("Malformed account payload".to_string()),
                });
                continue;
            }
        };

        let period = if payload.period == 0 { 30 } else { payload.period as u64 };
        let remaining_secs = (period - (now_ts % period)) as u32;
        let valid_until = now_ts + (remaining_secs as u64);

        match calculate_totp(&payload.secret, &payload.algorithm, payload.digits, payload.period, now_ts) {
            Ok(code) => {
                codes.push(TwofaCodeItem {
                    account_id: row.id,
                    code,
                    period: payload.period,
                    valid_until,
                    remaining_seconds: remaining_secs,
                    is_valid: true,
                    error: None,
                });
            }
            Err(e) => {
                codes.push(TwofaCodeItem {
                    account_id: row.id,
                    code: String::new(),
                    period: payload.period,
                    valid_until,
                    remaining_seconds: 0,
                    is_valid: false,
                    error: Some(e),
                });
            }
        }
    }

    Ok(TwofaCodeBatch {
        server_time: now_ts,
        codes,
    })
}

pub fn copy_twofa_code(
    app: AppHandle,
    state: &mut TwofaVaultState,
    conn: &mut SqliteConnection,
    account_id: &str,
    expected_session_id: &str,
) -> Result<TwofaCopyResult, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    state.validate_session(expected_session_id)?;
    state.touch_activity();

    let data_key = get_unlocked_data_key(state)?;
    let payload = get_account_payload_internal(conn, &data_key, account_id)?;

    let now_ts = Utc::now().timestamp() as u64;
    let code = calculate_totp(&payload.secret, &payload.algorithm, payload.digits, payload.period, now_ts)?;

    let period = if payload.period == 0 { 30 } else { payload.period as u64 };
    let remaining_seconds = (period - (now_ts % period)) as u32;

    state.last_copied_code = Some(code.clone());

    app.clipboard()
        .write_text(code.clone())
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    // Backend auto-clear timer
    if let Some(timeout_secs) = state.settings.clear_clipboard_setting.as_secs() {
        let app_handle = app.clone();
        let target_code = code.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(timeout_secs)).await;
            if let Ok(current) = app_handle.clipboard().read_text() {
                if current == target_code {
                    let _ = app_handle.clipboard().clear();
                }
            }
        });
    }

    Ok(TwofaCopyResult {
        success: true,
        remaining_seconds,
    })
}

// ============================================================================
// 11. Safe Native RFD File Export & Backup
// ============================================================================

pub fn save_content_with_token_check<F>(
    default_name: &str,
    filter_name: &str,
    filter_extensions: &[&str],
    data: &[u8],
    pre_commit_check: F,
) -> Result<bool, String>
where
    F: FnOnce() -> Result<(), String>,
{
    let mut dialog = rfd::FileDialog::new().set_file_name(default_name);
    for ext in filter_extensions {
        dialog = dialog.add_filter(filter_name, &[ext]);
    }
    let chosen_path = match dialog.save_file() {
        Some(p) => p,
        None => return Ok(false), // User cancelled - not an error
    };

    let parent_dir = chosen_path
        .parent()
        .ok_or_else(|| "Invalid destination path: no parent directory".to_string())?;

    let temp_name = format!(".tmp_{}_{}", Uuid::new_v4(), default_name);
    let temp_path = parent_dir.join(&temp_name);

    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temporary file: {}", e))?;
        file.write_all(data)
            .map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                format!("Failed to write temporary file: {}", e)
            })?;
        file.sync_all()
            .map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                format!("Failed to sync temporary file: {}", e)
            })?;
    }

    if let Err(e) = pre_commit_check() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(e);
    }

    if let Err(e) = atomic_replace_file(&temp_path, &chosen_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Failed to atomically save file: {}", e));
    }

    Ok(true)
}

pub fn save_content_via_file_dialog(
    default_name: &str,
    filter_name: &str,
    filter_extensions: &[&str],
    data: &[u8],
) -> Result<bool, String> {
    save_content_with_token_check(default_name, filter_name, filter_extensions, data, || Ok(()))
}

#[derive(Serialize, Deserialize)]
pub struct BackupKdfParams {
    pub algorithm: String,
    pub salt: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

#[derive(Serialize, Deserialize)]
pub struct BackupFileFormat {
    pub magic: String,
    pub version: u32,
    pub kdf: BackupKdfParams,
    pub cipher: String,
    pub nonce: String,
    pub payload: String,
}

#[derive(Serialize, Deserialize)]
pub struct BackupAccountItem {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub notes: String,
    pub icon: Option<String>,
    pub project_names: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct BackupPayload {
    pub version: u32,
    pub exported_at: String,
    pub accounts: Vec<BackupAccountItem>,
}

pub fn export_encrypted_backup_to_file(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    export_password: &str,
    expected_session_id: &str,
) -> Result<bool, String> {
    state.validate_session(expected_session_id)?;
    if export_password.len() < 8 {
        return Err("Export backup password must be at least 8 characters long".to_string());
    }
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();
    state.exempt_focus_lock(Duration::from_secs(30));

    let project_rows = sql_query("SELECT id, name FROM projects")
        .load::<ProjectNameRow>(conn)
        .unwrap_or_default();
    let project_name_map: HashMap<i64, String> = project_rows
        .into_iter()
        .map(|r| (r.id as i64, r.name))
        .collect();

    let rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
        .load::<AccountRow>(conn)
        .map_err(|e| format!("Failed to load accounts: {}", e))?;

    let links = sql_query("SELECT account_id, project_id FROM twofa_account_projects")
        .load::<AccountProjectRow>(conn)
        .map_err(|e| format!("Failed to load account links: {}", e))?;

    let mut project_links_map: HashMap<String, Vec<String>> = HashMap::new();
    for link in links {
        if let Some(pname) = project_name_map.get(&(link.project_id as i64)) {
            project_links_map.entry(link.account_id).or_default().push(pname.clone());
        }
    }

    let mut accounts = Vec::new();
    let mut corrupted_count = 0;

    for row in rows {
        let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        let aad = format!("pr_twofa_acc:{}:v1", row.id);
        let dec = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        let p: TwofaAccountSecretPayload = match serde_json::from_slice(&dec) {
            Ok(p) => p,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        let project_names = project_links_map.remove(&row.id).unwrap_or_default();
        accounts.push(BackupAccountItem {
            id: row.id,
            issuer: p.issuer,
            account: p.account,
            secret: p.secret,
            algorithm: p.algorithm,
            digits: p.digits,
            period: p.period,
            notes: p.notes,
            icon: p.icon,
            project_names,
        });
    }

    // Per requirement: If ANY account fails decryption/deserialization, ABORT export and report error!
    if corrupted_count > 0 {
        return Err(format!(
            "Cannot export backup: {} corrupted account record(s) failed decryption. Export was aborted to prevent data loss.",
            corrupted_count
        ));
    }

    let backup_payload = BackupPayload {
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        accounts,
    };

    let plaintext = serde_json::to_vec(&backup_payload)
        .map_err(|e| format!("Failed to serialize backup: {}", e))?;

    let salt = generate_random_bytes::<16>();
    let kwk = derive_kwk(export_password, &salt)?;
    let nonce = generate_random_bytes::<24>();

    let ciphertext = encrypt_data(&*kwk, &nonce, &plaintext, b"pr_twofa_backup_v1")?;

    let backup_file = BackupFileFormat {
        magic: "PR2FA".to_string(),
        version: 1,
        kdf: BackupKdfParams {
            algorithm: "Argon2id".to_string(),
            salt: BASE64.encode(&salt),
            memory_kib: 65536,
            iterations: 3,
            parallelism: 1,
        },
        cipher: "XChaCha20-Poly1305".to_string(),
        nonce: BASE64.encode(&nonce),
        payload: BASE64.encode(&ciphertext),
    };

    let json_bytes = serde_json::to_string_pretty(&backup_file)
        .map_err(|e| format!("Failed to format backup JSON: {}", e))?
        .into_bytes();

    let default_name = format!("projects_runner_2fa_backup_{}.pr2fa", Utc::now().format("%Y%m%d_%H%M%S"));
    save_content_via_file_dialog(&default_name, "Projects Runner 2FA Backup", &["pr2fa"], &json_bytes)
}

pub fn export_plaintext_to_file(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    expected_session_id: &str,
) -> Result<bool, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();
    state.exempt_focus_lock(Duration::from_secs(30));

    let rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
        .load::<AccountRow>(conn)
        .map_err(|e| format!("Failed to load accounts: {}", e))?;

    let mut uris = Vec::new();
    let mut corrupted_count = 0;

    for row in rows {
        let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        let aad = format!("pr_twofa_acc:{}:v1", row.id);
        let dec = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        let p: TwofaAccountSecretPayload = match serde_json::from_slice(&dec) {
            Ok(p) => p,
            Err(_) => {
                corrupted_count += 1;
                continue;
            }
        };

        match build_otpauth_uri(&p) {
            Ok(uri) => uris.push(uri),
            Err(_) => corrupted_count += 1,
        }
    }

    if corrupted_count > 0 {
        return Err(format!(
            "Cannot export plaintext URIs: {} record(s) failed validation. Export was aborted to prevent omitting accounts.",
            corrupted_count
        ));
    }

    let content = uris.join("\n");
    let default_name = format!("projects_runner_2fa_uris_{}.txt", Utc::now().format("%Y%m%d_%H%M%S"));
    save_content_via_file_dialog(&default_name, "Plaintext URI List", &["txt"], content.as_bytes())
}

pub fn export_account_qr_png_to_file(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    account_id: &str,
    expected_session_id: &str,
) -> Result<bool, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();
    state.exempt_focus_lock(Duration::from_secs(30));

    let payload = get_account_payload_internal(conn, &data_key, account_id)?;
    let uri = build_otpauth_uri(&payload)?;
    let png_bytes = generate_qr_png_bytes(&uri)?;

    let safe_name = if !payload.issuer.is_empty() {
        format!("{}_{}", payload.issuer, payload.account)
    } else {
        payload.account
    };
    let clean_name = safe_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();

    let default_name = format!("{}_2fa_qr.png", clean_name);
    save_content_via_file_dialog(&default_name, "PNG Images", &["png"], &png_bytes)
}

pub fn parse_backup_file_content(
    content: &str,
    password: &str,
) -> Result<Vec<(TwofaAccountSecretPayload, Vec<String>)>, String> {
    let backup_file: BackupFileFormat = serde_json::from_str(content)
        .map_err(|e| format!("Invalid backup file format: {}", e))?;

    if backup_file.magic != "PR2FA" {
        return Err("Invalid backup file: not a Projects Runner 2FA backup".to_string());
    }

    // Verify format profile strictly
    if backup_file.version != 1 {
        return Err(format!("Unsupported backup version: {}", backup_file.version));
    }
    if backup_file.cipher != "XChaCha20-Poly1305" {
        return Err(format!("Unsupported cipher profile: {}", backup_file.cipher));
    }
    if backup_file.kdf.algorithm != "Argon2id"
        || backup_file.kdf.memory_kib != 65536
        || backup_file.kdf.iterations != 3
        || backup_file.kdf.parallelism != 1
    {
        return Err("Unsupported KDF profile in backup file".to_string());
    }

    let salt = BASE64
        .decode(&backup_file.kdf.salt)
        .map_err(|_| "Invalid base64 salt in backup file".to_string())?;
    let nonce_bytes = BASE64
        .decode(&backup_file.nonce)
        .map_err(|_| "Invalid base64 nonce in backup file".to_string())?;
    let nonce_arr: [u8; 24] = nonce_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid nonce length in backup file".to_string())?;

    let ciphertext = BASE64
        .decode(&backup_file.payload)
        .map_err(|_| "Invalid base64 payload in backup file".to_string())?;

    let kwk = derive_kwk(password, &salt)?;
    let plaintext = decrypt_data(&*kwk, &nonce_arr, &ciphertext, b"pr_twofa_backup_v1")
        .map_err(|_| "Incorrect backup password or corrupted backup file".to_string())?;

    let backup_payload: BackupPayload = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Corrupted backup payload: {}", e))?;

    let mut result = Vec::new();
    for acc in backup_payload.accounts {
        let payload = TwofaAccountSecretPayload {
            issuer: acc.issuer,
            account: acc.account,
            secret: acc.secret,
            algorithm: acc.algorithm,
            digits: acc.digits,
            period: acc.period,
            notes: acc.notes,
            icon: acc.icon,
        };
        result.push((payload, acc.project_names));
    }

    Ok(result)
}

// ============================================================================
// 12. Preview & Commit Import Pipeline
// ============================================================================

pub fn preview_import_sources(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    raw_sources: Vec<(TwofaAccountSecretPayload, Vec<String>)>,
    expected_session_id: &str,
) -> Result<TwofaImportPreview, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();

    // Clean up expired previews (> 10 mins)
    let now = Instant::now();
    state.import_previews.retain(|_, (exp, _)| *exp > now);

    // Read all existing accounts to detect duplicates
    let existing_rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
        .load::<AccountRow>(conn)
        .map_err(|e| format!("Failed to read accounts: {}", e))?;

    let mut existing_map: Vec<(String, TwofaAccountSecretPayload)> = Vec::new();
    for row in existing_rows {
        if let Ok(nonce_arr) = row.nonce.as_slice().try_into() {
            let aad = format!("pr_twofa_acc:{}:v1", row.id);
            if let Ok(dec) = decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
                if let Ok(p) = serde_json::from_slice::<TwofaAccountSecretPayload>(&dec) {
                    existing_map.push((row.id, p));
                }
            }
        }
    }

    let mut pending_items = Vec::new();
    let mut preview_items = Vec::new();

    for (mut payload, suggested_project_names) in raw_sources {
        // Attempt canonicalization and record validation result
        let val_res = validate_and_canonicalize_payload(&mut payload);
        let is_valid = val_res.is_ok();
        let validation_error = val_res.err();

        let clean_secret = normalize_secret(&payload.secret);
        let temp_id = Uuid::new_v4().to_string();

        // 1. Check duplicate against existing DB accounts
        let mut is_dup = false;
        let mut existing_account_id = None;
        let mut existing_issuer = None;
        let mut existing_account = None;

        for (ex_id, ex_p) in &existing_map {
            if normalize_secret(&ex_p.secret) == clean_secret
                && ex_p.algorithm.eq_ignore_ascii_case(&payload.algorithm)
                && ex_p.digits == payload.digits
                && ex_p.period == payload.period
            {
                is_dup = true;
                existing_account_id = Some(ex_id.clone());
                existing_issuer = Some(ex_p.issuer.clone());
                existing_account = Some(ex_p.account.clone());
                break;
            }
        }

        // 2. Check duplicate against preceding items in the SAME import batch
        if !is_dup {
            for prev in &pending_items {
                let prev_item: &TwofaPendingImportItem = prev;
                if normalize_secret(&prev_item.payload.secret) == clean_secret
                    && prev_item.payload.algorithm.eq_ignore_ascii_case(&payload.algorithm)
                    && prev_item.payload.digits == payload.digits
                    && prev_item.payload.period == payload.period
                {
                    is_dup = true;
                    existing_issuer = Some(prev_item.payload.issuer.clone());
                    existing_account = Some(prev_item.payload.account.clone());
                    break;
                }
            }
        }

        preview_items.push(TwofaImportPreviewItem {
            temp_id: temp_id.clone(),
            issuer: payload.issuer.clone(),
            account: payload.account.clone(),
            algorithm: payload.algorithm.clone(),
            digits: payload.digits,
            period: payload.period,
            notes: payload.notes.clone(),
            icon: payload.icon.clone(),
            suggested_project_names: suggested_project_names.clone(),
            is_duplicate: is_dup,
            existing_account_id: existing_account_id.clone(),
            existing_issuer: existing_issuer.clone(),
            existing_account: existing_account.clone(),
            is_valid,
            validation_error: validation_error.clone(),
        });

        pending_items.push(TwofaPendingImportItem {
            temp_id,
            payload,
            suggested_project_names,
            is_duplicate: is_dup,
            existing_account_id,
            existing_issuer,
            existing_account,
            is_valid,
            validation_error,
        });
    }

    let preview_id = Uuid::new_v4().to_string();
    let expires_at = now + Duration::from_secs(600); // 10 minutes lifetime
    state.import_previews.insert(preview_id.clone(), (expires_at, pending_items));

    Ok(TwofaImportPreview {
        preview_id,
        items: preview_items,
        partial_warning: None,
    })
}

pub fn cancel_import_preview(
    state: &mut TwofaVaultState,
    preview_id: &str,
    expected_session_id: &str,
) -> Result<(), String> {
    state.validate_session(expected_session_id)?;
    state.import_previews.remove(preview_id);
    Ok(())
}

pub fn commit_import(
    conn: &mut SqliteConnection,
    state: &mut TwofaVaultState,
    preview_id: &str,
    selections: Vec<CommitImportItemSelection>,
    expected_session_id: &str,
) -> Result<TwofaImportCommitResult, String> {
    state.validate_session(expected_session_id)?;
    let data_key = get_unlocked_data_key(state)?;
    state.touch_activity();

    let now = Instant::now();
    let (expires_at, pending_items) = state
        .import_previews
        .get(preview_id)
        .ok_or_else(|| "Import preview session not found or expired".to_string())?;

    if now > *expires_at {
        state.import_previews.remove(preview_id);
        return Err("Import preview has expired. Please restart the import.".to_string());
    }

    let pending_map: HashMap<String, TwofaPendingImportItem> = pending_items
        .iter()
        .map(|item| (item.temp_id.clone(), item.clone()))
        .collect();

    // Read all existing accounts to accurately index duplicates
    let existing_rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
        .load::<AccountRow>(conn)
        .map_err(|e| format!("Failed to read accounts: {}", e))?;

    let mut secret_to_actual_id: HashMap<String, String> = HashMap::new();
    for row in existing_rows {
        if let Ok(nonce_arr) = row.nonce.as_slice().try_into() {
            let aad = format!("pr_twofa_acc:{}:v1", row.id);
            if let Ok(dec) = decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
                if let Ok(p) = serde_json::from_slice::<TwofaAccountSecretPayload>(&dec) {
                    secret_to_actual_id.insert(normalize_secret(&p.secret), row.id);
                }
            }
        }
    }

    let mut created_count = 0;
    let mut linked_count = 0;
    let mut skipped_count = 0;

    with_transaction(conn, |c| {
        let mut temp_to_actual_id: HashMap<String, String> = HashMap::new();

        for sel in selections {
            if !sel.selected || sel.action == ImportAction::Skip {
                skipped_count += 1;
                continue;
            }

            let pending = match pending_map.get(&sel.temp_id) {
                Some(p) => p,
                None => continue,
            };

            // Build final payload from user edits
            let mut payload = pending.payload.clone();
            payload.issuer = sel.issuer.trim().to_string();
            payload.account = sel.account.trim().to_string();
            if let Some(s) = &sel.secret {
                if !s.trim().is_empty() {
                    payload.secret = s.trim().to_string();
                }
            }
            if let Some(alg) = &sel.algorithm {
                payload.algorithm = alg.clone();
            }
            if let Some(d) = sel.digits {
                payload.digits = d;
            }
            if let Some(p) = sel.period {
                payload.period = p;
            }

            // Any invalid selection immediately fails and rolls back the transaction!
            validate_and_canonicalize_payload(&mut payload)?;

            let norm_secret = normalize_secret(&payload.secret);
            let existing_id = secret_to_actual_id.get(&norm_secret).cloned();

            if let Some(target_acc_id) = existing_id {
                match sel.action {
                    ImportAction::Skip => {
                        skipped_count += 1;
                        temp_to_actual_id.insert(sel.temp_id.clone(), target_acc_id);
                        continue;
                    }
                    ImportAction::Link | ImportAction::Create => {
                        // Even if user chose Create, existing account is linked to avoid duplicate accounts
                        let mut new_links = 0;
                        for pid in &sel.project_ids {
                            let rows = sql_query("INSERT OR IGNORE INTO twofa_account_projects (account_id, project_id) VALUES (?, ?)")
                                .bind::<Text, _>(&target_acc_id)
                                .bind::<Integer, _>(*pid as i32)
                                .execute(c)
                                .map_err(|e| format!("Failed to link project: {}", e))?;
                            new_links += rows;
                        }
                        if new_links > 0 {
                            linked_count += 1;
                        }
                        temp_to_actual_id.insert(sel.temp_id.clone(), target_acc_id);
                        continue;
                    }
                }
            }

            // New unique account: create
            let account_id = Uuid::new_v4().to_string();
            let nonce = generate_random_bytes::<24>();
            let plaintext = serde_json::to_vec(&payload)
                .map_err(|e| format!("Failed to serialize payload: {}", e))?;

            let aad = format!("pr_twofa_acc:{}:v1", account_id);
            let ciphertext = encrypt_data(&data_key, &nonce, &plaintext, aad.as_bytes())?;
            let now_str = Utc::now().to_rfc3339();

            sql_query("INSERT INTO twofa_accounts (id, encrypted_payload, nonce, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
                .bind::<Text, _>(&account_id)
                .bind::<Binary, _>(&ciphertext)
                .bind::<Binary, _>(&nonce)
                .bind::<Text, _>(&now_str)
                .bind::<Text, _>(&now_str)
                .execute(c)
                .map_err(|e| format!("Failed to insert account: {}", e))?;

            for pid in &sel.project_ids {
                sql_query("INSERT OR IGNORE INTO twofa_account_projects (account_id, project_id) VALUES (?, ?)")
                    .bind::<Text, _>(&account_id)
                    .bind::<Integer, _>(*pid as i32)
                    .execute(c)
                    .map_err(|e| format!("Failed to link project: {}", e))?;
            }

            secret_to_actual_id.insert(norm_secret, account_id.clone());
            temp_to_actual_id.insert(sel.temp_id.clone(), account_id);
            created_count += 1;
        }

        Ok(())
    })?;

    // Only clear preview after commit succeeds!
    state.import_previews.remove(preview_id);
    state.revision += 1;

    Ok(TwofaImportCommitResult {
        created_count,
        linked_count,
        skipped_count,
    })
}

// ============================================================================
// 13. Screen QR Capture (Window Management & Partial Handling)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwofaScanScreenResult {
    pub items: Vec<TwofaAccountSecretPayload>,
    pub partial_warning: Option<String>,
}

pub async fn scan_screen_for_totp_qrs(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    expected_session_id: &str,
) -> Result<TwofaScanScreenResult, String> {
    // 1. Verify session
    {
        let mut vault = state.twofa_vault.lock().unwrap();
        vault.validate_session(expected_session_id)?;
        vault.exempt_focus_lock(Duration::from_secs(30));
    }

    // 2. Hide window before capturing
    let main_window = app_handle.get_webview_window("main");
    if let Some(ref win) = main_window {
        let _ = win.hide();
    }
    tokio::time::sleep(Duration::from_millis(250)).await;

    // 3. Perform capture with panic guard to ALWAYS restore window
    let capture_res = std::panic::catch_unwind(|| -> Result<(Vec<TwofaAccountSecretPayload>, Option<String>), String> {
        let monitors = match xcap::Monitor::all() {
            Ok(m) => m,
            Err(e) => return Err(format!("CAPTURE_DENIED: Failed to enumerate displays: {}", e)),
        };
        if monitors.is_empty() {
            return Err("UNSUPPORTED: No displays available for screen capture".to_string());
        }

        let mut all_payloads = Vec::new();
        let mut failed_monitors_count = 0;
        let total_monitors = monitors.len();

        for monitor in &monitors {
            match monitor.capture_image() {
                Ok(img) => {
                    let dyn_img = image::DynamicImage::ImageRgba8(img);
                    let luma = dyn_img.to_luma8();
                    let uris = scan_qrs_from_luma(&luma);
                    for uri in uris {
                        if let Ok(payload) = parse_otpauth_uri(&uri) {
                            all_payloads.push(payload);
                        }
                    }
                }
                Err(_) => {
                    failed_monitors_count += 1;
                }
            }
        }

        if failed_monitors_count == total_monitors {
            return Err("CAPTURE_DENIED: Screen capture access was denied or failed for all displays".to_string());
        }

        let warning = if failed_monitors_count > 0 {
            Some(format!(
                "Screen capture failed on {} of {} displays. Showing QR codes detected on available displays.",
                failed_monitors_count, total_monitors
            ))
        } else {
            None
        };

        Ok((all_payloads, warning))
    });

    // 4. Always restore main window
    if let Some(ref win) = main_window {
        let _ = win.show();
        let _ = win.set_focus();
    }

    // 5. Re-check session before returning any secret!
    {
        let mut vault = state.twofa_vault.lock().unwrap();
        vault.validate_session(expected_session_id)?;
        vault.touch_activity();
    }

    match capture_res {
        Ok(Ok((payloads, warning))) => {
            if payloads.is_empty() {
                Err("NO_QR_FOUND: No valid 2FA QR codes detected on screen".to_string())
            } else {
                Ok(TwofaScanScreenResult {
                    items: payloads,
                    partial_warning: warning,
                })
            }
        }
        Ok(Err(err)) => Err(err),
        Err(_) => Err("CAPTURE_FAILED: An unexpected error occurred during screen capture".to_string()),
    }
}

// ============================================================================
// 14. Project Deletion Policy
// ============================================================================

pub fn preview_project_deletion_2fa(
    conn: &mut SqliteConnection,
    state: &TwofaVaultState,
    target_project_id: i64,
) -> Result<ProjectDelete2faPreview, String> {
    let is_locked = !state.is_unlocked();

    let account_ids_for_project = sql_query("SELECT account_id, project_id FROM twofa_account_projects WHERE project_id = ?")
        .bind::<Integer, _>(target_project_id as i32)
        .load::<AccountProjectRow>(conn)
        .map_err(|e| format!("Failed to read project 2fa links: {}", e))?
        .into_iter()
        .map(|r| r.account_id)
        .collect::<Vec<String>>();

    let mut exclusive_accounts_count = 0;
    let mut shared_accounts_count = 0;

    for acc_id in account_ids_for_project {
        let other_links_count: i32 = sql_query(
            "SELECT COUNT(*) as count FROM twofa_account_projects WHERE account_id = ? AND project_id != ?"
        )
        .bind::<Text, _>(&acc_id)
        .bind::<Integer, _>(target_project_id as i32)
        .get_result::<CountRow>(conn)
        .map(|r| r.count)
        .unwrap_or(0);

        if other_links_count == 0 {
            exclusive_accounts_count += 1;
        } else {
            shared_accounts_count += 1;
        }
    }

    Ok(ProjectDelete2faPreview {
        exclusive_accounts_count,
        shared_accounts_count,
        is_vault_locked: is_locked,
    })
}

pub fn delete_project_with_policy(
    conn: &mut SqliteConnection,
    state: &TwofaVaultState,
    target_project_id: i64,
    delete_exclusive_2fa: bool,
) -> Result<(), String> {
    let account_ids = sql_query("SELECT account_id, project_id FROM twofa_account_projects WHERE project_id = ?")
        .bind::<Integer, _>(target_project_id as i32)
        .load::<AccountProjectRow>(conn)
        .map_err(|e| format!("Failed to read project 2fa accounts: {}", e))?
        .into_iter()
        .map(|r| r.account_id)
        .collect::<Vec<String>>();

    let mut exclusive_to_delete = Vec::new();
    for acc_id in account_ids {
        let other_count: i32 = sql_query(
            "SELECT COUNT(*) as count FROM twofa_account_projects WHERE account_id = ? AND project_id != ?"
        )
        .bind::<Text, _>(&acc_id)
        .bind::<Integer, _>(target_project_id as i32)
        .get_result::<CountRow>(conn)
        .map(|r| r.count)
        .unwrap_or(0);

        if other_count == 0 {
            exclusive_to_delete.push(acc_id);
        }
    }

    with_transaction(conn, |c| {
        #[derive(QueryableByName)]
        struct RunningCount { #[diesel(sql_type = Integer)] count: i32 }
        let running = sql_query("SELECT COUNT(*) count FROM command_runs r JOIN commands c ON c.id=r.command_id WHERE c.project_id=? AND r.status='running'")
            .bind::<Integer, _>(target_project_id as i32).get_result::<RunningCount>(c).map_err(|e|e.to_string())?;
        if running.count > 0 { return Err("Stop project commands before deleting the project.".into()); }
        // Always remove links to this project
        sql_query("DELETE FROM twofa_account_projects WHERE project_id = ?")
            .bind::<Integer, _>(target_project_id as i32)
            .execute(c)
            .map_err(|e| format!("Failed to unlink 2fa accounts from project: {}", e))?;

        // If user explicitly chose to delete exclusive accounts and vault is unlocked
        if delete_exclusive_2fa && !exclusive_to_delete.is_empty() {
            if !state.is_unlocked() {
                return Err("Cannot delete exclusive 2FA accounts while 2FA vault is locked".to_string());
            }
            for acc_id in exclusive_to_delete {
                sql_query("DELETE FROM twofa_accounts WHERE id = ?")
                    .bind::<Text, _>(&acc_id)
                    .execute(c)
                    .map_err(|e| format!("Failed to delete exclusive 2fa account: {}", e))?;
            }
        }

        sql_query("DELETE FROM projects WHERE id=?").bind::<Integer, _>(target_project_id as i32).execute(c).map_err(|e|e.to_string())?;
        Ok(())
    })
}

// ============================================================================
// 15. Tauri IPC Command Handlers
// ============================================================================

#[tauri::command]
pub fn twofa_get_status(app: AppHandle, state: State<'_, AppState>) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    if let Some(reason) = state.twofa_vault.evaluate_auto_lock_reason() {
        state.twofa_vault.lock_with_reason(&app, reason);
    }
    state.twofa_vault.get_status(&crate::db_path_string(&state.paths))
}

#[tauri::command]
pub fn twofa_cancel_auth(
    app: AppHandle,
    state: State<'_, AppState>,
    operation_id: String,
) -> Result<(), TwofaSecurityError> {
    state.twofa_vault.cancel_auth(&operation_id, Some(&app))
}

#[tauri::command]
pub async fn twofa_cleanup_setup(
    state: State<'_, AppState>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.cleanup_setup(&crate::db_path_string(&state.paths)).await
}

#[tauri::command]
pub async fn twofa_try_auto_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.try_auto_unlock(&crate::db_path_string(&state.paths), Some(&app)).await
}

#[tauri::command]
pub async fn twofa_setup_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
    lock_enabled: bool,
    pin: Option<String>,
    settings: Option<TwofaVaultSettings>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.setup_vault(
        &crate::db_path_string(&state.paths),
        &password,
        lock_enabled,
        pin.as_deref(),
        settings,
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_unlock_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
    operation_id: Option<String>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.unlock_vault(
        &crate::db_path_string(&state.paths),
        &password,
        operation_id.as_deref(),
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_unlock_with_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    pin: String,
    operation_id: Option<String>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.unlock_with_pin(
        &crate::db_path_string(&state.paths),
        &pin,
        operation_id.as_deref(),
        Some(&app),
    ).await
}

#[tauri::command]
pub fn twofa_lock_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.lock_vault(&crate::db_path_string(&state.paths), Some(&app))
}

#[tauri::command]
pub fn twofa_touch_activity(
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<(), TwofaSecurityError> {
    state.twofa_vault.touch_activity(&expected_session_id)
}

#[tauri::command]
pub async fn twofa_set_lock_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    lock_enabled: bool,
    master_password: String,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.set_lock_enabled(
        &crate::db_path_string(&state.paths),
        lock_enabled,
        &master_password,
        &expected_session_id,
        expected_revision,
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_set_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    pin: String,
    master_password: String,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.set_pin(
        &crate::db_path_string(&state.paths),
        &pin,
        &master_password,
        &expected_session_id,
        expected_revision,
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_remove_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    master_password: String,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.remove_pin(
        &crate::db_path_string(&state.paths),
        &master_password,
        &expected_session_id,
        expected_revision,
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_change_password(
    app: AppHandle,
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.change_password(
        &crate::db_path_string(&state.paths),
        &old_password,
        &new_password,
        &expected_session_id,
        expected_revision,
        Some(&app),
    ).await
}

#[tauri::command]
pub async fn twofa_retry_recovery(
    app: AppHandle,
    state: State<'_, AppState>,
    master_password: String,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.retry_recovery(
        &crate::db_path_string(&state.paths),
        &master_password,
        &expected_session_id,
        expected_revision,
        Some(&app),
    ).await
}

#[tauri::command]
pub fn twofa_update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: TwofaVaultSettings,
    expected_session_id: String,
    expected_revision: u64,
) -> Result<TwofaVaultStatus, TwofaSecurityError> {
    state.twofa_vault.update_settings(
        &crate::db_path_string(&state.paths),
        settings,
        &expected_session_id,
        expected_revision,
        Some(&app),
    )
}

#[tauri::command]
pub fn twofa_list_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: Option<i64>,
    unassigned_only: Option<bool>,
    search: Option<String>,
    expected_session_id: String,
) -> Result<Vec<TwofaAccountSummary>, String> {
    if let Some(reason) = state.twofa_vault.evaluate_auto_lock_reason() {
        state.twofa_vault.lock_with_reason(&app, reason);
        return Err("Vault is locked".to_string());
    }
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    list_accounts(
        &mut conn,
        &mut vault,
        project_id,
        unassigned_only.unwrap_or(false),
        search,
        &expected_session_id,
    )
}

#[tauri::command]
pub fn twofa_get_codes(
    app: AppHandle,
    state: State<'_, AppState>,
    account_ids: Option<Vec<String>>,
    expected_session_id: String,
) -> Result<TwofaCodeBatch, String> {
    if let Some(reason) = state.twofa_vault.evaluate_auto_lock_reason() {
        state.twofa_vault.lock_with_reason(&app, reason);
        return Err("Vault is locked".to_string());
    }
    let vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    get_twofa_codes(&mut conn, &vault, account_ids, &expected_session_id)
}

#[tauri::command]
pub fn twofa_copy_code(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    expected_session_id: String,
) -> Result<TwofaCopyResult, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let (code, remaining_seconds, timeout_secs, copy_gen, copy_session_id) = {
        let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
        vault.check_auto_lock();
        vault.validate_session(&expected_session_id)?;
        vault.touch_activity();

        let data_key = get_unlocked_data_key(&vault)?;
        let mut conn = crate::connect(&state.paths)?;
        let payload = get_account_payload_internal(&mut conn, &data_key, &account_id)?;

        let now_ts = Utc::now().timestamp() as u64;
        let code = calculate_totp(&payload.secret, &payload.algorithm, payload.digits, payload.period, now_ts)?;

        let period = if payload.period == 0 { 30 } else { payload.period as u64 };
        let remaining_seconds = (period - (now_ts % period)) as u32;

        vault.last_copied_code = Some(code.clone());
        let timeout_secs = vault.settings.clear_clipboard_setting.as_secs();
        let copy_gen = state.twofa_vault.clipboard_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        let copy_session_id = vault.session_id.clone().unwrap_or_default();
        (code, remaining_seconds, timeout_secs, copy_gen, copy_session_id)
    };

    // Re-verify session before writing to OS clipboard
    {
        let vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
        if !vault.is_unlocked() || vault.session_id.as_deref() != Some(&copy_session_id) {
            return Err("Vault was locked before clipboard write could complete".to_string());
        }
    }

    app.clipboard()
        .write_text(code.clone())
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    if let Some(timeout) = timeout_secs {
        let app_handle = app.clone();
        let target_code = code;
        let vault_service = state.twofa_vault.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(timeout)).await;
            vault_service.clear_clipboard_if_generation_matches(&app_handle, copy_gen, &target_code);
        });
    }

    Ok(TwofaCopyResult {
        success: true,
        remaining_seconds,
    })
}

#[tauri::command]
pub fn twofa_create_account(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TwofaAccountInput,
    expected_session_id: String,
) -> Result<TwofaAccountSummary, String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    let summary = create_account(&mut conn, &mut vault, input, &expected_session_id)?;
    let _ = app.emit("twofa:accounts-changed", serde_json::json!({ "revision": vault.revision }));
    Ok(summary)
}

#[tauri::command]
pub fn twofa_update_account(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    input: TwofaAccountInput,
    expected_session_id: String,
) -> Result<TwofaAccountSummary, String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    let summary = update_account(&mut conn, &mut vault, &id, input, &expected_session_id)?;
    let _ = app.emit("twofa:accounts-changed", serde_json::json!({ "revision": vault.revision }));
    Ok(summary)
}

#[tauri::command]
pub fn twofa_delete_account(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    expected_session_id: String,
) -> Result<(), String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    delete_account(&mut conn, &mut vault, &id, &expected_session_id)?;
    let _ = app.emit("twofa:accounts-changed", serde_json::json!({ "revision": vault.revision }));
    Ok(())
}

#[tauri::command]
pub fn twofa_get_account_secret(
    state: State<'_, AppState>,
    id: String,
    expected_session_id: String,
) -> Result<TwofaAccountSecretPayload, String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    vault.validate_session(&expected_session_id)?;
    let data_key = get_unlocked_data_key(&vault)?;
    vault.touch_activity();

    let mut conn = crate::connect(&state.paths)?;
    get_account_payload_internal(&mut conn, &data_key, &id)
}

#[tauri::command]
pub fn twofa_get_account_qr(
    state: State<'_, AppState>,
    id: String,
    expected_session_id: String,
) -> Result<String, String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    vault.validate_session(&expected_session_id)?;
    let data_key = get_unlocked_data_key(&vault)?;
    vault.touch_activity();

    let mut conn = crate::connect(&state.paths)?;
    let payload = get_account_payload_internal(&mut conn, &data_key, &id)?;
    let uri = build_otpauth_uri(&payload)?;
    generate_qr_data_url(&uri)
}

#[tauri::command]
pub fn twofa_save_qr_png(
    state: State<'_, AppState>,
    id: String,
    expected_session_id: String,
) -> Result<bool, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let (default_name, png_bytes) = {
        let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
        let data_key = get_unlocked_data_key(&vault)?;
        vault.touch_activity();

        let mut conn = crate::connect(&state.paths)?;
        let payload = get_account_payload_internal(&mut conn, &data_key, &id)?;
        let uri = build_otpauth_uri(&payload)?;
        let png_bytes = generate_qr_png_bytes(&uri)?;

        let safe_name = if !payload.issuer.is_empty() {
            format!("{}_{}", payload.issuer, payload.account)
        } else {
            payload.account
        };
        let clean_name = safe_name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>();
        let default_name = format!("{}_2fa_qr.png", clean_name);
        (default_name, png_bytes)
    };

    let vault_svc = state.twofa_vault.clone();
    let op_token = token.clone();
    let saved = save_content_with_token_check(
        &default_name,
        "PNG Images",
        &["png"],
        &png_bytes,
        move || vault_svc.verify_operation(&op_token),
    )?;
    state.twofa_vault.verify_operation(&token)?;
    Ok(saved)
}

#[tauri::command]
pub async fn twofa_scan_screen_qr(
    app: AppHandle,
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<TwofaScanScreenResult, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let main_window = app.get_webview_window("main");
    if let Some(ref win) = main_window {
        let _ = win.hide();
    }
    tokio::time::sleep(Duration::from_millis(250)).await;

    struct WindowRestorer<'a> {
        win: Option<&'a tauri::WebviewWindow>,
    }
    impl<'a> Drop for WindowRestorer<'a> {
        fn drop(&mut self) {
            if let Some(w) = self.win {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
    let _restore_guard = WindowRestorer { win: main_window.as_ref() };

    let capture_res = tokio::time::timeout(
        Duration::from_secs(15),
        tauri::async_runtime::spawn_blocking(move || {
            std::panic::catch_unwind(|| -> Result<(Vec<TwofaAccountSecretPayload>, Option<String>), String> {
                let monitors = match xcap::Monitor::all() {
                    Ok(m) => m,
                    Err(e) => return Err(format!("CAPTURE_DENIED: Failed to enumerate displays: {}", e)),
                };
                if monitors.is_empty() {
                    return Err("UNSUPPORTED: No displays available for screen capture".to_string());
                }

                let mut all_payloads = Vec::new();
                let mut failed_monitors_count = 0;
                let total_monitors = monitors.len();

                for monitor in &monitors {
                    match monitor.capture_image() {
                        Ok(img) => {
                            let dyn_img = image::DynamicImage::ImageRgba8(img);
                            let luma = dyn_img.to_luma8();
                            let uris = scan_qrs_from_luma(&luma);
                            for uri in uris {
                                if let Ok(payload) = parse_otpauth_uri(&uri) {
                                    all_payloads.push(payload);
                                }
                            }
                        }
                        Err(_) => {
                            failed_monitors_count += 1;
                        }
                    }
                }

                if failed_monitors_count == total_monitors {
                    return Err("CAPTURE_DENIED: Screen capture access was denied or failed for all displays".to_string());
                }

                let warning = if failed_monitors_count > 0 {
                    Some(format!(
                        "Screen capture failed on {} of {} displays. Showing QR codes detected on available displays.",
                        failed_monitors_count, total_monitors
                    ))
                } else {
                    None
                };

                Ok((all_payloads, warning))
            })
        })
    ).await.map_err(|_| "Screen capture timed out after 15 seconds".to_string())?
    .map_err(|e| format!("Screen scan worker task failed: {}", e))?;

    drop(_restore_guard);

    state.twofa_vault.verify_operation(&token)?;

    match capture_res {
        Ok(Ok((payloads, warning))) => {
            if payloads.is_empty() {
                Err("NO_QR_FOUND: No valid 2FA QR codes detected on screen".to_string())
            } else {
                Ok(TwofaScanScreenResult {
                    items: payloads,
                    partial_warning: warning,
                })
            }
        }
        Ok(Err(err)) => Err(err),
        Err(_) => Err("Screen capture worker crashed unexpectedly".to_string()),
    }
}

#[tauri::command]
pub async fn twofa_scan_image_qr(
    state: State<'_, AppState>,
    image_data_base64: String,
    expected_session_id: String,
) -> Result<Vec<TwofaAccountSecretPayload>, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let clean_b64 = if let Some(idx) = image_data_base64.find(',') {
        image_data_base64[idx + 1..].to_string()
    } else {
        image_data_base64
    };

    let bytes = BASE64
        .decode(clean_b64.trim())
        .map_err(|e| format!("Invalid base64 image data: {}", e))?;

    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Image is too large (maximum 20 MB allowed)".to_string());
    }

    let payloads = tauri::async_runtime::spawn_blocking(move || {
        scan_totp_from_image_bytes(&bytes)
    }).await.map_err(|e| format!("Image scan worker task failed: {}", e))??;

    state.twofa_vault.verify_operation(&token)?;
    Ok(payloads)
}

#[tauri::command]
pub async fn twofa_pick_and_scan_image_qr(
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<Vec<TwofaAccountSecretPayload>, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let dialog = rfd::FileDialog::new()
        .add_filter("Image Files", &["png", "jpg", "jpeg", "webp"]);
    let path = match dialog.pick_file() {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let metadata = std::fs::metadata(&path).map_err(|e| format!("Failed to read image metadata: {}", e))?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("Image file is too large (maximum 20 MB allowed)".to_string());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read image file: {}", e))?;
    let payloads = tauri::async_runtime::spawn_blocking(move || {
        scan_totp_from_image_bytes(&bytes)
    }).await.map_err(|e| format!("Image scan worker task failed: {}", e))??;

    state.twofa_vault.verify_operation(&token)?;
    Ok(payloads)
}

#[tauri::command]
pub async fn twofa_preview_import_from_image(
    state: State<'_, AppState>,
    image_data_base64: String,
    expected_session_id: String,
) -> Result<TwofaImportPreview, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let clean_b64 = if let Some(idx) = image_data_base64.find(',') {
        image_data_base64[idx + 1..].to_string()
    } else {
        image_data_base64
    };

    let bytes = BASE64
        .decode(clean_b64.trim())
        .map_err(|e| format!("Invalid base64 image data: {}", e))?;

    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Image is too large (maximum 20 MB allowed)".to_string());
    }

    let payloads = tauri::async_runtime::spawn_blocking(move || {
        scan_totp_from_image_bytes(&bytes)
    }).await.map_err(|e| format!("Image scan worker task failed: {}", e))??;

    if payloads.is_empty() {
        return Err("NO_QR_FOUND: No valid 2FA QR codes found in selected image".to_string());
    }

    state.twofa_vault.verify_operation(&token)?;

    let sources: Vec<(TwofaAccountSecretPayload, Vec<String>)> = payloads.into_iter().map(|p| (p, Vec::new())).collect();
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    preview_import_sources(&mut conn, &mut vault, sources, &expected_session_id)
}

#[tauri::command]
pub async fn twofa_preview_import_from_image_dialog(
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<TwofaImportPreview, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let dialog = rfd::FileDialog::new()
        .add_filter("Image Files", &["png", "jpg", "jpeg", "webp"]);
    let path = match dialog.pick_file() {
        Some(p) => p,
        None => return Err("NO_FILE_SELECTED".to_string()),
    };

    let metadata = std::fs::metadata(&path).map_err(|e| format!("Failed to read image metadata: {}", e))?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("Image file is too large (maximum 20 MB allowed)".to_string());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read image file: {}", e))?;
    let payloads = tauri::async_runtime::spawn_blocking(move || {
        scan_totp_from_image_bytes(&bytes)
    }).await.map_err(|e| format!("Image scan worker task failed: {}", e))??;

    if payloads.is_empty() {
        return Err("NO_QR_FOUND: No valid 2FA QR codes found in selected image".to_string());
    }

    state.twofa_vault.verify_operation(&token)?;

    let sources: Vec<(TwofaAccountSecretPayload, Vec<String>)> = payloads.into_iter().map(|p| (p, Vec::new())).collect();
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    preview_import_sources(&mut conn, &mut vault, sources, &expected_session_id)
}

#[tauri::command]
pub async fn twofa_preview_import_from_screen(
    app: AppHandle,
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<TwofaImportPreview, String> {
    let scan_res = twofa_scan_screen_qr(app, state.clone(), expected_session_id.clone()).await?;
    let sources: Vec<(TwofaAccountSecretPayload, Vec<String>)> = scan_res.items.into_iter().map(|p| (p, Vec::new())).collect();
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    let mut preview = preview_import_sources(&mut conn, &mut vault, sources, &expected_session_id)?;
    if let Some(warn) = scan_res.partial_warning {
        preview.partial_warning = Some(match preview.partial_warning {
            Some(existing) => format!("{}\n{}", existing, warn),
            None => warn,
        });
    }
    Ok(preview)
}

#[tauri::command]
pub fn twofa_preview_import(
    state: State<'_, AppState>,
    uris: Vec<String>,
    expected_session_id: String,
) -> Result<TwofaImportPreview, String> {
    let mut sources = Vec::new();
    for uri in uris {
        if uri.trim().is_empty() {
            continue;
        }
        match parse_otpauth_uri(&uri) {
            Ok(payload) => sources.push((payload, Vec::new())),
            Err(e) => return Err(format!("Failed to parse URI: {}", e)),
        }
    }

    if sources.is_empty() {
        return Err("No valid TOTP URIs provided to import".to_string());
    }

    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    preview_import_sources(&mut conn, &mut vault, sources, &expected_session_id)
}

#[tauri::command]
pub fn twofa_cancel_import_preview(
    state: State<'_, AppState>,
    preview_id: String,
    expected_session_id: String,
) -> Result<(), String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    cancel_import_preview(&mut vault, &preview_id, &expected_session_id)
}

#[tauri::command]
pub fn twofa_import_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    preview_id: String,
    selections: Vec<CommitImportItemSelection>,
    expected_session_id: String,
) -> Result<TwofaImportCommitResult, String> {
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    let res = commit_import(&mut conn, &mut vault, &preview_id, selections, &expected_session_id)?;
    let _ = app.emit("twofa:accounts-changed", serde_json::json!({ "revision": vault.revision }));
    Ok(res)
}

#[tauri::command]
pub fn twofa_export_plaintext(
    state: State<'_, AppState>,
    expected_session_id: String,
) -> Result<bool, String> {
    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let content_bytes = {
        let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
        let data_key = get_unlocked_data_key(&vault)?;
        vault.touch_activity();

        let mut conn = crate::connect(&state.paths)?;
        let rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
            .load::<AccountRow>(&mut conn)
            .map_err(|e| format!("Failed to load accounts: {}", e))?;

        let mut uris = Vec::new();
        let mut corrupted_count = 0;

        for row in rows {
            let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
                Ok(arr) => arr,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            let aad = format!("pr_twofa_acc:{}:v1", row.id);
            let dec = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
                Ok(b) => b,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            let p: TwofaAccountSecretPayload = match serde_json::from_slice(&dec) {
                Ok(p) => p,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            match build_otpauth_uri(&p) {
                Ok(uri) => uris.push(uri),
                Err(_) => corrupted_count += 1,
            }
        }

        if corrupted_count > 0 {
            return Err(format!(
                "Cannot export plaintext URIs: {} record(s) failed validation. Export was aborted to prevent omitting accounts.",
                corrupted_count
            ));
        }

        uris.join("\n").into_bytes()
    };

    let default_name = format!("projects_runner_2fa_uris_{}.txt", Utc::now().format("%Y%m%d_%H%M%S"));
    let vault_svc = state.twofa_vault.clone();
    let op_token = token.clone();
    let saved = save_content_with_token_check(
        &default_name,
        "Plaintext URI List",
        &["txt"],
        &content_bytes,
        move || vault_svc.verify_operation(&op_token),
    )?;
    state.twofa_vault.verify_operation(&token)?;
    Ok(saved)
}

#[tauri::command]
pub async fn twofa_export_encrypted_backup(
    state: State<'_, AppState>,
    password: String,
    expected_session_id: String,
) -> Result<bool, String> {
    if password.len() < 8 {
        return Err("Export backup password must be at least 8 characters long".to_string());
    }

    let token = state.twofa_vault.begin_operation(&expected_session_id, Duration::from_secs(30))?;

    let backup_payload = {
        let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
        let data_key = get_unlocked_data_key(&vault)?;
        vault.touch_activity();

        let mut conn = crate::connect(&state.paths)?;
        let project_rows = sql_query("SELECT id, name FROM projects")
            .load::<ProjectNameRow>(&mut conn)
            .unwrap_or_default();
        let project_name_map: HashMap<i64, String> = project_rows
            .into_iter()
            .map(|r| (r.id as i64, r.name))
            .collect();

        let rows = sql_query("SELECT id, encrypted_payload, nonce, created_at, updated_at FROM twofa_accounts")
            .load::<AccountRow>(&mut conn)
            .map_err(|e| format!("Failed to load accounts: {}", e))?;

        let links = sql_query("SELECT account_id, project_id FROM twofa_account_projects")
            .load::<AccountProjectRow>(&mut conn)
            .map_err(|e| format!("Failed to load account links: {}", e))?;

        let mut project_links_map: HashMap<String, Vec<String>> = HashMap::new();
        for link in links {
            if let Some(pname) = project_name_map.get(&(link.project_id as i64)) {
                project_links_map.entry(link.account_id).or_default().push(pname.clone());
            }
        }

        let mut accounts = Vec::new();
        let mut corrupted_count = 0;

        for row in rows {
            let nonce_arr: [u8; 24] = match row.nonce.as_slice().try_into() {
                Ok(arr) => arr,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            let aad = format!("pr_twofa_acc:{}:v1", row.id);
            let dec = match decrypt_data(&data_key, &nonce_arr, &row.encrypted_payload, aad.as_bytes()) {
                Ok(b) => b,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            let p: TwofaAccountSecretPayload = match serde_json::from_slice(&dec) {
                Ok(p) => p,
                Err(_) => {
                    corrupted_count += 1;
                    continue;
                }
            };

            let project_names = project_links_map.remove(&row.id).unwrap_or_default();
            accounts.push(BackupAccountItem {
                id: row.id,
                issuer: p.issuer,
                account: p.account,
                secret: p.secret,
                algorithm: p.algorithm,
                digits: p.digits,
                period: p.period,
                notes: p.notes,
                icon: p.icon,
                project_names,
            });
        }

        if corrupted_count > 0 {
            return Err(format!(
                "Cannot export backup: {} corrupted account record(s) failed decryption. Export was aborted to prevent data loss.",
                corrupted_count
            ));
        }

        BackupPayload {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            accounts,
        }
    };

    let json_bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let plaintext = serde_json::to_vec(&backup_payload)
            .map_err(|e| format!("Failed to serialize backup: {}", e))?;

        let salt = generate_random_bytes::<16>();
        let kwk = derive_kwk(&password, &salt)?;
        let nonce = generate_random_bytes::<24>();

        let ciphertext = encrypt_data(&*kwk, &nonce, &plaintext, b"pr_twofa_backup_v1")?;

        let backup_file = BackupFileFormat {
            magic: "PR2FA".to_string(),
            version: 1,
            kdf: BackupKdfParams {
                algorithm: "Argon2id".to_string(),
                salt: BASE64.encode(&salt),
                memory_kib: 65536,
                iterations: 3,
                parallelism: 1,
            },
            cipher: "XChaCha20-Poly1305".to_string(),
            nonce: BASE64.encode(&nonce),
            payload: BASE64.encode(&ciphertext),
        };

        let json_bytes = serde_json::to_string_pretty(&backup_file)
            .map_err(|e| format!("Failed to format backup JSON: {}", e))?
            .into_bytes();
        Ok(json_bytes)
    })
    .await
    .map_err(|e| format!("Encryption worker task failed: {}", e))??;

    let default_name = format!("projects_runner_2fa_backup_{}.pr2fa", Utc::now().format("%Y%m%d_%H%M%S"));
    let vault_svc = state.twofa_vault.clone();
    let op_token = token.clone();
    let saved = save_content_with_token_check(
        &default_name,
        "Projects Runner 2FA Backup",
        &["pr2fa"],
        &json_bytes,
        move || vault_svc.verify_operation(&op_token),
    )?;

    state.twofa_vault.verify_operation(&token)?;
    Ok(saved)
}

#[tauri::command]
pub fn twofa_import_encrypted_backup(
    state: State<'_, AppState>,
    backup_content: String,
    password: String,
    expected_session_id: String,
) -> Result<TwofaImportPreview, String> {
    let sources = parse_backup_file_content(&backup_content, &password)?;
    let mut vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    preview_import_sources(&mut conn, &mut vault, sources, &expected_session_id)
}

#[tauri::command]
pub fn twofa_preview_project_deletion(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<ProjectDelete2faPreview, String> {
    let vault = state.twofa_vault.lock().map_err(|e| e.to_string())?;
    let mut conn = crate::connect(&state.paths)?;
    preview_project_deletion_2fa(&mut conn, &vault, project_id)
}
