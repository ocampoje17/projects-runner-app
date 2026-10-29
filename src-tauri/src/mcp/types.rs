use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const PERMISSIONS: &[&str] = &[
    "projects.read",
    "projects.create",
    "projects.update",
    "projects.delete",
    "commands.read",
    "commands.create",
    "commands.update",
    "commands.delete",
    "commands.execute",
    "commands.output.read",
    "notes.read",
    "notes.create",
    "notes.update",
    "notes.delete",
    "twofa.accounts.read",
    "twofa.codes.read",
    "sync.read",
    "sync.run",
];

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpSettings {
    pub enabled: bool,
    pub port: u16,
}
impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 6811,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpStatus {
    pub settings: McpSettings,
    pub state: String,
    pub endpoint: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpClient {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub token_prefix: String,
    pub project_scope: String,
    pub permissions: Vec<String>,
    pub project_ids: Vec<i32>,
    pub account_ids: Vec<String>,
    pub policy_revision: i32,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpClientUpdate {
    pub name: String,
    pub enabled: bool,
    pub project_scope: String,
    pub permissions: Vec<String>,
    pub project_ids: Vec<i32>,
    pub account_ids: Vec<String>,
    pub expected_policy_revision: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpClientToken {
    pub client: McpClient,
    pub token: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpActivity {
    pub id: i32,
    pub client_id: String,
    pub client_name: String,
    pub tool: String,
    pub target_id: Option<String>,
    pub created_at: String,
    pub success: bool,
    pub error_code: Option<String>,
    pub duration_ms: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpActivityPage {
    pub items: Vec<McpActivity>,
    pub has_more: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpBridgeInfo {
    pub path: Option<String>,
    pub error: Option<String>,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpSyncJob {
    pub id: String,
    pub state: String,
    pub error_code: Option<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpOutputPage {
    pub text: String,
    pub next_cursor: String,
    pub truncated: bool,
    pub ended: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpRunRef {
    #[ts(type = "number")]
    pub run_id: i64,
    #[ts(type = "number")]
    pub command_id: i64,
    pub runtime_mode: String,
    pub terminal_session_id: Option<String>,
    pub status: String,
    pub output_available: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpOtpResult {
    pub account_id: String,
    pub code: String,
    #[ts(type = "number")]
    pub server_time: u64,
    #[ts(type = "number")]
    pub valid_until: u64,
    pub remaining_seconds: u32,
    pub period: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpError {
    pub code: String,
    pub message: String,
}
impl McpError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl From<String> for McpError {
    fn from(_: String) -> Self {
        Self::new("INTERNAL_ERROR", "The operation could not be completed.")
    }
}
pub type Result<T> = std::result::Result<T, McpError>;
