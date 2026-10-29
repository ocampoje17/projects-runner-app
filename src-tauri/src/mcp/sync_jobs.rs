use super::{policy, store, types::*, McpService};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
pub struct OwnedJob {
    pub client: McpClient,
    pub public: McpSyncJob,
    pub committing: bool,
}
#[derive(Default)]
pub struct Jobs {
    pub ready: Option<std::time::Instant>,
    pub active: Option<String>,
    pub values: HashMap<String, OwnedJob>,
}
pub fn busy(app: &AppHandle) -> bool {
    app.state::<McpService>()
        .jobs
        .lock()
        .unwrap()
        .active
        .is_some()
}
pub fn start(app: &AppHandle, c: &McpClient) -> Result<McpSyncJob> {
    let sync = app.state::<crate::data_sync::SyncService>();
    let _coordination = sync
        .coordination
        .lock()
        .map_err(|_| McpError::new("SYNC_BUSY", "Another sync is active."))?;
    policy::permission(c, "sync.run")?;
    if c.project_scope != "all" {
        return Err(McpError::new(
            "PERMISSION_DENIED",
            "Sync requires access to all projects.",
        ));
    }
    let status = crate::data_sync::sync_get_status(app.state())?;
    if status.folder.is_none() {
        return Err(McpError::new(
            "SYNC_NOT_CONFIGURED",
            "Choose a Data Sync folder in the app.",
        ));
    }
    if crate::data_sync::is_busy(&app.state::<crate::data_sync::SyncService>()) {
        return Err(McpError::new("SYNC_BUSY", "Another sync is active."));
    }
    let service = app.state::<McpService>();
    let mut jobs = service.jobs.lock().unwrap();
    if jobs.ready.is_none_or(|t| t.elapsed().as_secs() > 30) {
        return Err(McpError::new(
            "APP_NOT_READY",
            "The app frontend is not ready.",
        ));
    }
    if jobs.active.is_some() {
        return Err(McpError::new("SYNC_BUSY", "Another sync is active."));
    }
    let job = McpSyncJob {
        id: uuid::Uuid::new_v4().to_string(),
        state: "queued".into(),
        error_code: None,
        created_at: crate::now(),
    };
    jobs.active = Some(job.id.clone());
    jobs.values.insert(
        job.id.clone(),
        OwnedJob {
            client: c.clone(),
            public: job.clone(),
            committing: false,
        },
    );
    if jobs.values.len() > 100 {
        let active = jobs.active.clone();
        let oldest = jobs
            .values
            .iter()
            .filter(|(id, _)| Some(*id) != active.as_ref())
            .min_by_key(|(_, v)| v.public.created_at.clone())
            .map(|(id, _)| id.clone());
        if let Some(id) = oldest {
            jobs.values.remove(&id);
        }
    }
    drop(jobs);
    if app.emit("mcp://sync-request", &job).is_err() {
        let mut jobs = service.jobs.lock().unwrap();
        jobs.active = None;
        jobs.values.remove(&job.id);
        return Err(McpError::new(
            "APP_NOT_READY",
            "The app frontend is not ready.",
        ));
    }
    Ok(job)
}
pub fn get(app: &AppHandle, c: &McpClient, id: &str) -> Result<McpSyncJob> {
    let service = app.state::<McpService>();
    let jobs = service.jobs.lock().unwrap();
    let j = jobs
        .values
        .get(id)
        .filter(|j| j.client.id == c.id)
        .ok_or_else(|| McpError::new("JOB_NOT_FOUND", "Sync job not found."))?;
    Ok(j.public.clone())
}
pub fn authorize(app: &AppHandle, id: Option<&str>) -> std::result::Result<(), String> {
    let service = app.state::<McpService>();
    let jobs = service.jobs.lock().unwrap();
    match (&jobs.active, id) {
        (None, None) => Ok(()),
        (Some(active), Some(id)) if active == id => {
            let j = jobs.values.get(id).ok_or("Sync job expired")?;
            let c = policy::refresh(&app.state::<crate::AppState>().paths, &j.client)
                .map_err(|_| "Sync permission revoked")?;
            policy::permission(&c, "sync.run").map_err(|_| "Sync permission revoked")?;
            if c.project_scope != "all" {
                return Err("Sync permission revoked".into());
            }
            Ok(())
        }
        _ => Err("Another sync is active.".into()),
    }
}
pub fn cancel_pending(app: &AppHandle, client_id: Option<&str>) {
    let sync = app.state::<crate::data_sync::SyncService>();
    let Ok(_coordination) = sync.coordination.lock() else {
        return;
    };
    let service = app.state::<McpService>();
    let mut jobs = service.jobs.lock().unwrap();
    let Some(id) = jobs.active.clone() else {
        return;
    };
    let Some(job) = jobs.values.get_mut(&id) else {
        return;
    };
    if job.committing || client_id.is_some_and(|c| c != job.client.id) {
        return;
    }
    job.public.state = "cancelled".into();
    jobs.active = None;
    drop(jobs);
    crate::data_sync::cancel_mcp_session(app);
    let _ = app.emit("mcp://sync-cancelled", id);
}
pub fn cancel_if_revoked(app: &AppHandle, id: &str) {
    let c = store::client(&app.state::<crate::AppState>().paths, id);
    if c.is_err()
        || c.is_ok_and(|c| {
            !c.enabled || c.project_scope != "all" || policy::permission(&c, "sync.run").is_err()
        })
    {
        cancel_pending(app, Some(id));
    }
}
pub fn committing(app: &AppHandle, id: Option<&str>, value: bool) {
    if let Some(id) = id {
        if let Some(j) = app
            .state::<McpService>()
            .jobs
            .lock()
            .unwrap()
            .values
            .get_mut(id)
        {
            j.committing = value;
        }
    }
}
#[tauri::command]
pub fn mcp_sync_ready(app: AppHandle, ready: bool) {
    let service = app.state::<McpService>();
    service.jobs.lock().unwrap().ready = if ready {
        Some(std::time::Instant::now())
    } else {
        None
    };
    if !ready {
        cancel_pending(&app, None);
    }
}
#[tauri::command]
pub fn mcp_sync_progress(
    id: String,
    state: String,
    error_code: Option<String>,
    app: AppHandle,
) -> std::result::Result<(), String> {
    if ![
        "running",
        "needs_review",
        "completed",
        "cancelled",
        "failed",
    ]
    .contains(&state.as_str())
    {
        return Err("Invalid job state".into());
    }
    let service = app.state::<McpService>();
    let mut jobs = service.jobs.lock().unwrap();
    if jobs.active.as_ref() != Some(&id) {
        return Ok(());
    }
    if let Some(job) = jobs.values.get_mut(&id) {
        job.public.state = state.clone();
        job.public.error_code = error_code;
        job.committing = false;
    }
    if ["completed", "cancelled", "failed"].contains(&state.as_str()) {
        jobs.active = None;
    }
    Ok(())
}
