use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InteractiveSessionInfo {
    pub session_id: String,
    #[ts(type = "number")]
    pub run_id: i64,
    #[ts(type = "number")]
    pub command_id: i64,
    pub cols: u16,
    pub rows: u16,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum TerminalChannelEvent {
    Started {
        session_id: String,
        #[ts(type = "number")]
        run_id: i64,
        #[ts(type = "number")]
        command_id: i64,
        #[ts(type = "number")]
        generation: u64,
        #[ts(type = "number")]
        sequence: u64,
        cols: u16,
        rows: u16,
        started_at: String,
    },
    Output {
        session_id: String,
        #[ts(type = "number")]
        generation: u64,
        #[ts(type = "number")]
        sequence: u64,
        data: String,
    },
    Error {
        session_id: String,
        #[ts(type = "number")]
        generation: u64,
        #[ts(type = "number")]
        sequence: u64,
        error: String,
    },
    Exited {
        session_id: String,
        #[ts(type = "number")]
        run_id: i64,
        #[ts(type = "number")]
        command_id: i64,
        #[ts(type = "number")]
        generation: u64,
        #[ts(type = "number")]
        sequence: u64,
        exit_code: Option<i32>,
        status: String,
        ended_at: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TerminalAckPayload {
    pub session_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    #[ts(type = "number")]
    pub sequence: u64,
    pub bytes_processed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TerminalResizePayload {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}
