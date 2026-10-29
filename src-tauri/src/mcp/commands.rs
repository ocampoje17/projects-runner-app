use super::{policy, store, types::*};
use crate::{
    connect, load_command, start_interactive_command_locked, start_non_interactive_command_locked,
    update_command_in_conn, AppPaths, AppState, CommandInput, CommandRun, Project, ProjectCommand,
    RUNTIME_MODE_EXTERNAL_TERMINAL, RUNTIME_MODE_INTERNAL_INTERACTIVE,
};
use diesel::{prelude::*, sql_query};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// Policy writers use the same gate as the final authorization and process spawn.
// Never hold it while waiting for a previous run, awaiting, or cancelling sync.
pub(super) fn with_operation<T>(
    operations: &Mutex<()>,
    task: impl FnOnce() -> Result<T>,
) -> Result<T> {
    let _operation = operations
        .lock()
        .map_err(|_| McpError::new("INTERNAL_ERROR", "Command runtime unavailable."))?;
    task()
}

fn current_client(paths: &AppPaths, baseline: &McpClient) -> Result<McpClient> {
    if !store::settings(paths)?.enabled {
        return Err(McpError::new("PERMISSION_DENIED", "MCP is disabled."));
    }
    policy::refresh(paths, baseline).map_err(|error| {
        if error.code == "NOT_FOUND" {
            McpError::new("PERMISSION_DENIED", "Client access was revoked.")
        } else {
            error
        }
    })
}

fn permitted_command(
    conn: &mut SqliteConnection,
    client: &McpClient,
    command_id: i64,
) -> Result<(ProjectCommand, Project)> {
    let (command, project) = load_command(conn, command_id)
        .map_err(|_| McpError::new("NOT_FOUND", "Command not found."))?;
    policy::project(client, command.project_id)?;
    Ok((command, project))
}

pub(super) fn update(
    paths: &AppPaths,
    operations: &Mutex<()>,
    baseline: &McpClient,
    command_id: i64,
    patch: &Value,
) -> Result<Value> {
    with_operation(operations, || {
        let client = current_client(paths, baseline)?;
        policy::permission(&client, "commands.update")?;
        let mut conn = connect(paths)?;
        let (command, _) = permitted_command(&mut conn, &client, command_id)?;
        let mut input = json!({
            "project_id":command.project_id,"name":command.name,"script":command.script,
            "avatar_path":command.avatar_path,
            "ports":serde_json::from_str::<Vec<u16>>(&command.ports).unwrap_or_default(),
            "section":command.section,"order_index":command.order_index,
            "runtime_mode":command.runtime_mode,
            "run_in_external_terminal":command.run_in_external_terminal != 0,
            "external_terminal_kind":command.external_terminal_kind,
            "interactive_terminal_kind":command.interactive_terminal_kind
        });
        let fields = patch
            .as_object()
            .ok_or_else(|| McpError::new("INVALID_ARGUMENT", "Expected an argument object."))?;
        for (key, value) in fields {
            if key != "command_id" {
                input[key] = value.clone();
            }
        }
        let input: CommandInput = serde_json::from_value(input)
            .map_err(|_| McpError::new("INVALID_ARGUMENT", "Invalid command fields."))?;
        policy::project(&client, input.project_id)?;
        sql_query(format!(
            "SELECT * FROM projects WHERE id={}",
            input.project_id
        ))
        .get_result::<Project>(&mut conn)
        .map_err(|_| McpError::new("NOT_FOUND", "Project not found."))?;
        let saved = update_command_in_conn(&mut conn, command_id, input)?;
        if policy::permission(&client, "commands.read").is_ok() {
            serde_json::to_value(saved).map_err(|e| e.to_string().into())
        } else {
            Ok(json!({"command_id":saved.id,"updated":true}))
        }
    })
}

// The injected wait/spawn boundaries let tests control ordering without sleeping
// or starting a real shell. Production supplies the existing runtime functions.
pub(super) fn start_with<T>(
    paths: &AppPaths,
    operations: &Mutex<()>,
    baseline: &McpClient,
    command_id: i64,
    wait: impl FnOnce() -> Result<()>,
    spawn: impl FnOnce(ProjectCommand, Project) -> Result<T>,
) -> Result<T> {
    wait()?;
    with_operation(operations, || {
        let client = current_client(paths, baseline)?;
        policy::permission(&client, "commands.execute")?;
        let (command, project) = permitted_command(&mut connect(paths)?, &client, command_id)?;
        spawn(command, project)
    })
}

pub(super) fn start(
    app: &AppHandle,
    baseline: &McpClient,
    command_id: i64,
    wait: impl FnOnce() -> Result<()>,
) -> Result<McpRunRef> {
    let state = app.state::<AppState>();
    start_with(
        &state.paths,
        &state.terminal_supervisor.command_operations,
        baseline,
        command_id,
        wait,
        |command, project| {
            let runtime_mode = command.runtime_mode.clone();
            let start_error = |message: String| {
                if message.to_lowercase().contains("already running") {
                    McpError::new("COMMAND_ALREADY_RUNNING", "Command is already running.")
                } else {
                    McpError::from(message)
                }
            };
            let (run, session_id) = if runtime_mode == RUNTIME_MODE_INTERNAL_INTERACTIVE {
                let sink =
                    crate::terminal_supervisor::TerminalSink::detached(app.clone(), command_id);
                let info = start_interactive_command_locked(
                    command,
                    project,
                    120,
                    30,
                    sink,
                    app.clone(),
                    &state,
                )
                .map_err(start_error)?;
                let run = sql_query(format!(
                    "SELECT * FROM command_runs WHERE id={}",
                    info.run_id
                ))
                .get_result::<CommandRun>(&mut connect(&state.paths)?)
                .map_err(|e| e.to_string())?;
                (run, Some(info.session_id))
            } else {
                (
                    start_non_interactive_command_locked(command, project, app, &state)
                        .map_err(start_error)?,
                    None,
                )
            };
            Ok(McpRunRef {
                run_id: run.id,
                command_id,
                output_available: runtime_mode != RUNTIME_MODE_EXTERNAL_TERMINAL,
                runtime_mode,
                terminal_session_id: session_id,
                status: run.status,
            })
        },
    )
}
