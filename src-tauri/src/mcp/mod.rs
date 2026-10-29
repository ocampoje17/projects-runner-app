mod bridge;
mod commands;
pub mod notes;
pub mod output;
pub mod policy;
mod server;
pub mod store;
pub mod sync_jobs;
mod tools;
pub mod types;
pub(crate) fn install_bridge(app: &tauri::AppHandle) {
    let _ = bridge::install(app);
}
#[cfg(feature = "mcp-integration")]
pub mod integration;
#[cfg(test)]
mod tests;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use types::*;

pub struct McpService {
    status: Mutex<(String, Option<String>)>,
    listener: Mutex<Option<(CancellationToken, tauri::async_runtime::JoinHandle<()>)>>,
    lifecycle: tokio::sync::Mutex<()>,
    pub limits: Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>,
    pub jobs: Mutex<sync_jobs::Jobs>,
    pub output: Mutex<output::OutputStore>,
}
impl Default for McpService {
    fn default() -> Self {
        Self {
            status: Mutex::new(("disabled".into(), None)),
            listener: Mutex::new(None),
            lifecycle: tokio::sync::Mutex::new(()),
            limits: Mutex::new(HashMap::new()),
            jobs: Mutex::new(Default::default()),
            output: Mutex::new(Default::default()),
        }
    }
}
impl McpService {
    pub fn stop(&self) {
        if let Some((ct, _)) = self.listener.lock().unwrap().take() {
            ct.cancel();
        }
        *self.status.lock().unwrap() = ("disabled".into(), None);
    }
    pub fn status(&self, app: &AppHandle) -> std::result::Result<McpStatus, String> {
        let s = store::settings(&app.state::<crate::AppState>().paths)?;
        let (state, error) = self.status.lock().unwrap().clone();
        Ok(McpStatus {
            endpoint: format!("http://127.0.0.1:{}/mcp", s.port),
            settings: s,
            state,
            error,
        })
    }
    fn emit(&self, app: &AppHandle) {
        if let Ok(s) = self.status(app) {
            let _ = app.emit("mcp://status", s);
        }
    }
    pub async fn configure(
        &self,
        app: AppHandle,
        s: McpSettings,
        restart: bool,
    ) -> std::result::Result<McpStatus, String> {
        let _guard = self.lifecycle.lock().await;
        if s.port == 0 {
            return Err("Port must be between 1 and 65535.".into());
        }
        let paths = &app.state::<crate::AppState>().paths;
        let old = store::settings(paths)?;
        if !s.enabled {
            {
                let state = app.state::<crate::AppState>();
                commands::with_operation(&state.terminal_supervisor.command_operations, || {
                    store::save_settings(paths, &s).map_err(Into::into)
                }).map_err(|e| e.message)?;
            }
            *self.status.lock().unwrap() = ("stopping".into(), None);
            self.emit(&app);
            let previous = self.listener.lock().unwrap().take();
            if let Some((ct, task)) = previous {
                ct.cancel();
                let _ = tokio::time::timeout(std::time::Duration::from_secs(3), task).await;
            }
            *self.status.lock().unwrap() = ("disabled".into(), None);
            sync_jobs::cancel_pending(&app, None);
            self.emit(&app);
            return self.status(&app);
        }
        if !restart && old.port == s.port && self.listener.lock().unwrap().is_some() {
            store::save_settings(paths, &s)?;
            return self.status(&app);
        }
        if restart && old.port == s.port {
            let previous = self.listener.lock().unwrap().take();
            if let Some((ct, task)) = previous {
                ct.cancel();
                let _ = tokio::time::timeout(std::time::Duration::from_secs(3), task).await;
            }
        }
        *self.status.lock().unwrap() = ("starting".into(), None);
        self.emit(&app);
        let listener =
            match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, s.port)).await {
                Ok(l) => l,
                Err(e) => {
                    if self.listener.lock().unwrap().is_some() {
                        *self.status.lock().unwrap() = (
                            "running".into(),
                            Some(format!("Port {} is unavailable.", s.port)),
                        );
                    } else {
                        store::save_settings(paths, &s)?;
                        *self.status.lock().unwrap() = ("error".into(), Some(e.to_string()));
                    }
                    self.emit(&app);
                    return self.status(&app);
                }
            };
        store::save_settings(paths, &s)?;
        let ct = CancellationToken::new();
        let task = server::spawn(app.clone(), listener, s.port, ct.clone());
        if let Some((old, _)) = self.listener.lock().unwrap().replace((ct, task)) {
            old.cancel();
        }
        *self.status.lock().unwrap() = ("running".into(), None);
        self.emit(&app);
        self.status(&app)
    }
}

#[tauri::command]
pub fn mcp_get_status(
    app: AppHandle,
    service: State<McpService>,
) -> std::result::Result<McpStatus, String> {
    service.status(&app)
}
#[tauri::command]
pub async fn mcp_update_settings(
    app: AppHandle,
    settings: McpSettings,
    service: State<'_, McpService>,
) -> std::result::Result<McpStatus, String> {
    service.configure(app, settings, false).await
}
#[tauri::command]
pub async fn mcp_restart_server(
    app: AppHandle,
    service: State<'_, McpService>,
) -> std::result::Result<McpStatus, String> {
    let settings = store::settings(&app.state::<crate::AppState>().paths)?;
    service.configure(app, settings, true).await
}
#[tauri::command]
pub async fn mcp_test_connection(app: AppHandle) -> std::result::Result<String, String> {
    use rmcp::{
        transport::{
            streamable_http_client::StreamableHttpClientTransportConfig,
            StreamableHttpClientTransport,
        },
        ServiceExt,
    };
    let s = store::settings(&app.state::<crate::AppState>().paths)?;
    let paths = app.state::<crate::AppState>().paths.clone();
    let probe = store::create(&paths, "Connection test".into()).map_err(|e| e.message)?;
    struct Cleanup(crate::AppPaths, String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = store::remove(&self.0, &self.1);
        }
    }
    let _cleanup = Cleanup(paths, probe.client.id);
    let transport = StreamableHttpClientTransport::from_config(
        StreamableHttpClientTransportConfig::with_uri(format!("http://127.0.0.1:{}/mcp", s.port))
            .auth_header(probe.token)
            .reinit_on_expired_session(false),
    );
    let remote = tokio::time::timeout(std::time::Duration::from_secs(5), ().serve(transport))
        .await
        .map_err(|_| "MCP connection timed out.")?
        .map_err(|_| "MCP protocol handshake failed.")?;
    let _ = remote.cancel().await;
    Ok(crate::now())
}
#[tauri::command]
pub fn mcp_list_clients(
    state: State<crate::AppState>,
) -> std::result::Result<Vec<McpClient>, String> {
    store::clients(&state.paths)
}
#[tauri::command]
pub fn mcp_create_client(name: String, state: State<crate::AppState>) -> Result<McpClientToken> {
    store::create(&state.paths, name)
}
#[tauri::command]
pub fn mcp_update_client(
    id: String,
    update: McpClientUpdate,
    app: AppHandle,
    state: State<crate::AppState>,
) -> Result<McpClient> {
    let c = commands::with_operation(&state.terminal_supervisor.command_operations, || {
        store::update(&state.paths, &id, update)
    })?;
    sync_jobs::cancel_if_revoked(&app, &id);
    Ok(c)
}
#[tauri::command]
pub fn mcp_rotate_client_token(
    id: String,
    app: AppHandle,
    state: State<crate::AppState>,
) -> Result<McpClientToken> {
    let t = commands::with_operation(&state.terminal_supervisor.command_operations, || {
        store::rotate(&state.paths, &id)
    })?;
    sync_jobs::cancel_pending(&app, Some(&id));
    Ok(t)
}
#[tauri::command]
pub fn mcp_delete_client(id: String, app: AppHandle, state: State<crate::AppState>) -> Result<()> {
    commands::with_operation(&state.terminal_supervisor.command_operations, || {
        store::remove(&state.paths, &id)
    })?;
    sync_jobs::cancel_pending(&app, Some(&id));
    Ok(())
}
#[tauri::command]
pub fn mcp_list_activity(
    client_id: Option<String>,
    success: Option<bool>,
    offset: Option<u32>,
    state: State<crate::AppState>,
) -> Result<McpActivityPage> {
    store::activities(&state.paths, client_id, success, offset.unwrap_or(0))
}
#[tauri::command]
pub fn mcp_get_bridge_info(app: AppHandle) -> McpBridgeInfo {
    bridge::install(&app)
}
