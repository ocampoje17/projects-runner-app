//! Opt-in desktop integration checks. All data lives in a disposable directory.
use super::{store, types::*, McpService};
use crate::*;
use rmcp::{model::CallToolRequestParams, transport::TokioChildProcess, ServiceExt};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI32, Ordering};

static EXIT: AtomicI32 = AtomicI32::new(1);
struct Http {
    client: reqwest::Client,
    url: String,
    token: String,
}
impl Http {
    async fn rpc(&self, method: &str, params: Value) -> std::result::Result<Value, String> {
        let response=self.client.post(&self.url).bearer_auth(&self.token).header("Accept","application/json, text/event-stream").header("MCP-Protocol-Version","2025-11-25")
            .json(&json!({"jsonrpc":"2.0","id":uuid::Uuid::new_v4().to_string(),"method":method,"params":params})).send().await.map_err(|e|e.to_string())?;
        let status = response.status();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("{method}: HTTP {status}: {text}"));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|_| format!("Invalid protocol response: {text}"))?;
        if value.get("error").is_some() {
            return Err(format!("{method}: {}", value["error"]));
        }
        Ok(value["result"].clone())
    }
    async fn tool(&self, name: &str, args: Value) -> std::result::Result<Value, String> {
        let result = self
            .rpc("tools/call", json!({"name":name,"arguments":args}))
            .await?;
        let data = result["structuredContent"].clone();
        if result["isError"] == true {
            return Err(format!("{name}: {data}"));
        }
        Ok(data)
    }
    async fn error(&self, name: &str, args: Value, code: &str) -> std::result::Result<(), String> {
        let result = self
            .rpc("tools/call", json!({"name":name,"arguments":args}))
            .await?;
        if result["isError"] != true || result["structuredContent"]["code"] != code {
            return Err(format!("Expected {code} from {name}, received {result}"));
        }
        Ok(())
    }
}
fn check(value: bool, message: &str) -> std::result::Result<(), String> {
    if value {
        Ok(())
    } else {
        Err(message.into())
    }
}
async fn checks(app: AppHandle, root: PathBuf) -> std::result::Result<(), String> {
    let paths = app.state::<AppState>().paths.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let settings = McpSettings {
        enabled: true,
        port,
    };
    let state = app
        .state::<McpService>()
        .configure(app.clone(), settings, false)
        .await?;
    check(state.state == "running", "Listener did not start")?;
    let t = store::create(&paths, "Smoke AI".into()).map_err(|e| e.message)?;
    let http = Http {
        client: reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap(),
        url: state.endpoint.clone(),
        token: t.token.clone(),
    };
    let init=http.rpc("initialize",json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"integration","version":"1"}})).await?;
    check(
        init["protocolVersion"].is_string(),
        "Protocol handshake failed",
    )?;
    check(
        http.rpc("tools/list", json!({})).await?["tools"]
            .as_array()
            .is_some_and(|t| t.is_empty()),
        "New clients must have no tools",
    )?;
    http.error("projects_list", json!({}), "PERMISSION_DENIED")
        .await?;
    let mut client = store::update(
        &paths,
        &t.client.id,
        McpClientUpdate {
            name: t.client.name.clone(),
            enabled: true,
            project_scope: "selected".into(),
            project_ids: vec![],
            account_ids: vec![],
            permissions: PERMISSIONS.iter().map(|p| p.to_string()).collect(),
            expected_policy_revision: 1,
        },
    )
    .map_err(|e| e.message)?;
    let project = http
        .tool(
            "projects_create",
            json!({"name":"Smoke project","path":root.to_string_lossy()}),
        )
        .await?;
    let pid = project["id"].as_i64().ok_or("Missing project ID")?;
    check(
        project.get("notes").is_none(),
        "Project metadata leaked notes",
    )?;
    check(
        store::client(&paths, &client.id)
            .unwrap()
            .project_ids
            .contains(&(pid as i32)),
        "New project missing from allowlist",
    )?;
    http.error("projects_get", json!({"project_id":99999}), "NOT_FOUND")
        .await?;
    let a = http
        .tool(
            "notes_create",
            json!({"project_id":pid,"title":"A","content":"one"}),
        )
        .await?;
    let b = http
        .tool(
            "notes_create",
            json!({"project_id":pid,"title":"B","content":"two"}),
        )
        .await?;
    http.tool("notes_update",json!({"project_id":pid,"note_id":a["id"],"expected_version":a["version"],"content":"updated"})).await?;
    http.error(
        "notes_delete",
        json!({"project_id":pid,"note_id":a["id"],"expected_version":a["version"]}),
        "CONFLICT",
    )
    .await?;
    http.tool(
        "projects_update",
        json!({"project_id":pid,"description":"metadata patch"}),
    )
    .await?;
    check(
        http.tool("notes_list", json!({"project_id":pid})).await?["items"]
            .as_array()
            .unwrap()
            .len()
            == 2,
        "Metadata update lost notes",
    )?;
    http.tool(
        "notes_delete",
        json!({"project_id":pid,"note_id":b["id"],"expected_version":b["version"]}),
    )
    .await?;
    eprintln!("HTTP auth, discovery, scopes, project and note CRUD passed");
    for mode in [
        RUNTIME_MODE_INTERNAL_HEADLESS,
        RUNTIME_MODE_INTERNAL_INTERACTIVE,
        RUNTIME_MODE_EXTERNAL_TERMINAL,
    ] {
        let command=http.tool("commands_create",json!({"project_id":pid,"name":mode,"script":"echo MCP_SMOKE\nexit 0","runtime_mode":mode,"interactive_terminal_kind":if cfg!(windows){"cmd"}else{"bash"}})).await?;
        let cid = command["id"].as_i64().unwrap();
        http.tool(
            "commands_update",
            json!({"command_id":cid,"name":format!("{mode} edited")}),
        )
        .await?;
        eprintln!("Starting runtime {mode}");
        let run = http
            .tool("commands_start", json!({"command_id":cid}))
            .await?;
        let rid = run["run_id"].as_i64().ok_or("Run ID missing")?;
        if mode == RUNTIME_MODE_EXTERNAL_TERMINAL {
            http.error(
                "runs_read_output",
                json!({"run_id":rid}),
                "OUTPUT_UNAVAILABLE",
            )
            .await?;
            http.tool("commands_stop", json!({"run_id":rid})).await?;
        }
        for _ in 0..200 {
            let r = http.tool("runs_get", json!({"run_id":rid})).await?;
            if r["status"] != "running" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        if http.tool("runs_get", json!({"run_id":rid})).await?["status"] == "running" {
            eprintln!(
                "Timed out {mode}. Output: {:?}",
                http.tool("runs_read_output", json!({"run_id":rid})).await
            );
            for snapshot in app
                .state::<AppState>()
                .terminal_supervisor
                .detached_snapshots()
            {
                eprintln!("Raw: {:?}", snapshot);
            }
        }
        check(
            http.tool("runs_get", json!({"run_id":rid})).await?["status"] != "running",
            "Run did not exit",
        )?;
        if mode == RUNTIME_MODE_EXTERNAL_TERMINAL {
            http.error(
                "runs_read_output",
                json!({"run_id":rid}),
                "OUTPUT_UNAVAILABLE",
            )
            .await?;
        } else {
            let output = http.tool("runs_read_output", json!({"run_id":rid})).await?;
            check(
                output["text"]
                    .as_str()
                    .is_some_and(|s| s.contains("MCP_SMOKE")),
                "Missing captured output",
            )?;
        }
        http.tool("commands_stop", json!({"run_id":rid})).await?;
        http.tool("commands_delete", json!({"command_id":cid}))
            .await?;
    }
    eprintln!("All three command runtimes and output checks passed");
    let long_script = if cfg!(windows) {
        "echo MCP_RESTART\nStart-Sleep -Seconds 30"
    } else {
        "echo MCP_RESTART\nsleep 30"
    };
    let command = http.tool("commands_create", json!({"project_id":pid,"name":"Restart fixture","script":long_script,"runtime_mode":RUNTIME_MODE_INTERNAL_HEADLESS})).await?;
    let cid = command["id"].as_i64().unwrap();
    let first = http
        .tool("commands_start", json!({"command_id":cid}))
        .await?;
    http.error(
        "commands_start",
        json!({"command_id":cid}),
        "COMMAND_ALREADY_RUNNING",
    )
    .await?;
    http.error(
        "commands_delete",
        json!({"command_id":cid}),
        "COMMAND_RUNNING",
    )
    .await?;
    let second = http
        .tool("commands_restart", json!({"command_id":cid}))
        .await?;
    check(first["run_id"] != second["run_id"], "Restart reused a run")?;
    http.tool("commands_stop", json!({"run_id":second["run_id"]}))
        .await?;
    http.tool("commands_stop", json!({"run_id":second["run_id"]}))
        .await?;
    http.tool("commands_delete", json!({"command_id":cid}))
        .await?;
    eprintln!("Duplicate start, running deletion, restart and idempotent stop passed");
    // Fixture vault uses a fake account and never writes a system credential.
    let vault = app.state::<AppState>().twofa_vault.clone();
    vault
        .setup_vault(
            &db_path_string(&paths),
            "McpFixturePassword123!",
            true,
            None,
            None,
            None,
        )
        .await
        .map_err(|e| e.message)?;
    let (account, last_activity) = {
        let mut v = vault.lock().unwrap();
        // This fixture has no background vault timer or real user activity.
        v.last_tick_instant = std::time::Instant::now();
        v.settings.lock_time_setting = twofa::LockTimeSetting::Never;
        v.settings.lock_on_screen_lock = false;
        let session = v.session_id.clone().unwrap();
        let a = twofa::create_account(
            &mut connect(&paths)?,
            &mut v,
            twofa::TwofaAccountInput {
                issuer: "Fixture".into(),
                account: "test@example.invalid".into(),
                secret: Some("JBSWY3DPEHPK3PXP".into()),
                algorithm: None,
                digits: None,
                period: None,
                notes: Some("private".into()),
                icon: None,
                project_ids: None,
            },
            &session,
        )?;
        (a, v.last_activity)
    };
    client = store::client(&paths, &client.id).unwrap();
    client = store::update(
        &paths,
        &client.id,
        McpClientUpdate {
            name: client.name.clone(),
            enabled: true,
            project_scope: "all".into(),
            permissions: PERMISSIONS.iter().map(|p| p.to_string()).collect(),
            project_ids: vec![],
            account_ids: vec![account.id.clone()],
            expected_policy_revision: client.policy_revision,
        },
    )
    .map_err(|e| e.message)?;
    http.error(
        "twofa_get_code",
        json!({"account_id":""}),
        "INVALID_ARGUMENT",
    )
    .await?;
    http.error(
        "twofa_get_code",
        json!({"account_id":"ungranted"}),
        "NOT_FOUND",
    )
    .await?;
    let otp = http
        .tool("twofa_get_code", json!({"account_id":account.id}))
        .await?;
    check(
        otp["code"].as_str().is_some_and(|s| s.len() == 6),
        "OTP missing",
    )?;
    check(
        vault.lock().unwrap().last_activity == last_activity,
        "MCP extended vault activity",
    )?;
    let accounts = http.tool("twofa_accounts_list", json!({})).await?;
    check(
        accounts["items"][0].get("notes").is_none() && accounts["items"][0].get("secret").is_none(),
        "Account metadata leaked private fields",
    )?;
    vault
        .lock_vault(&db_path_string(&paths), Some(&app))
        .map_err(|e| e.message)?;
    http.error(
        "twofa_get_code",
        json!({"account_id":account.id}),
        "VAULT_LOCKED",
    )
    .await?;
    eprintln!("OTP allowlist, unlocked/locked vault and activity checks passed");
    let sync_dir = root.join("sync");
    fs::create_dir_all(&sync_dir).map_err(|e| e.to_string())?;
    crate::data_sync::sync_configure(
        app.clone(),
        Some(sync_dir.to_string_lossy().into()),
        Default::default(),
        app.state(),
        app.state(),
    )
    .await?;
    http.error("sync_start", json!({}), "APP_NOT_READY").await?;
    super::sync_jobs::mcp_sync_ready(app.clone(), true);
    let job = http.tool("sync_start", json!({})).await?;
    let job_id = job["id"].as_str().unwrap().to_string();
    http.error("sync_start", json!({}), "SYNC_BUSY").await?;
    check(
        crate::data_sync::sync_prepare(
            app.clone(),
            None,
            Default::default(),
            None,
            None,
            app.state(),
            app.state(),
        )
        .await
        .is_err(),
        "UI replaced an MCP sync",
    )?;
    let preview = crate::data_sync::sync_prepare(
        app.clone(),
        Some(job_id.clone()),
        Default::default(),
        None,
        None,
        app.state(),
        app.state(),
    )
    .await?;
    crate::data_sync::sync_commit(
        app.clone(),
        Some(job_id.clone()),
        preview.session_id,
        Default::default(),
        Default::default(),
        app.state(),
        app.state(),
    )
    .await?;
    super::sync_jobs::mcp_sync_progress(job_id.clone(), "completed".into(), None, app.clone())?;
    check(
        http.tool("sync_get_job", json!({"job_id":job_id})).await?["state"] == "completed",
        "Sync job incomplete",
    )?;
    eprintln!("Data Sync ownership and prepare/commit checks passed");
    // Exercise the actual stdio executable with the SDK client.
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let bridge = executable.parent().unwrap().join(if cfg!(windows) {
        "projects-runner-mcp.exe"
    } else {
        "projects-runner-mcp"
    });
    let mut command = tokio::process::Command::new(bridge);
    command
        .args(["--url", &http.url])
        .env("PROJECTS_RUNNER_MCP_TOKEN", &http.token);
    let transport = TokioChildProcess::new(command).map_err(|e| e.to_string())?;
    let remote = ().serve(transport).await.map_err(|e| e.to_string())?;
    let list = remote.list_tools(None).await.map_err(|e| e.to_string())?;
    check(!list.tools.is_empty(), "Stdio discovery failed")?;
    let result = remote
        .call_tool(CallToolRequestParams::new("projects_list"))
        .await
        .map_err(|e| e.to_string())?;
    check(result.is_error != Some(true), "Stdio tool call failed")?;
    let _ = remote.cancel().await;
    store::rotate(&paths, &client.id).map_err(|e| e.message)?;
    check(
        http.client
            .post(&http.url)
            .bearer_auth(&http.token)
            .send()
            .await
            .unwrap()
            .status()
            == reqwest::StatusCode::UNAUTHORIZED,
        "Rotated token remained active",
    )?;
    check(
        http.client
            .post(&http.url)
            .header("Origin", "https://untrusted.example")
            .bearer_auth(&http.token)
            .send()
            .await
            .unwrap()
            .status()
            == reqwest::StatusCode::FORBIDDEN,
        "Bad origin accepted",
    )?;
    eprintln!("Stdio bridge, token rotation and origin checks passed");
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let occupied_port = occupied.local_addr().unwrap().port();
    let retained = app
        .state::<McpService>()
        .configure(
            app.clone(),
            McpSettings {
                enabled: true,
                port: occupied_port,
            },
            false,
        )
        .await?;
    check(
        retained.state == "running" && retained.settings.port == port,
        "Failed port change lost the listener",
    )?;
    let restarted = app
        .state::<McpService>()
        .configure(
            app.clone(),
            McpSettings {
                enabled: true,
                port,
            },
            true,
        )
        .await?;
    check(restarted.state == "running", "Restart failed")?;
    super::mcp_test_connection(app.clone()).await?;
    app.state::<McpService>()
        .configure(
            app.clone(),
            McpSettings {
                enabled: false,
                port,
            },
            false,
        )
        .await?;
    let reopened = app
        .state::<McpService>()
        .configure(
            app.clone(),
            McpSettings {
                enabled: true,
                port,
            },
            false,
        )
        .await?;
    check(reopened.state == "running", "Immediate re-enable failed")?;
    app.state::<McpService>()
        .configure(
            app.clone(),
            McpSettings {
                enabled: false,
                port,
            },
            false,
        )
        .await?;
    eprintln!("Port collision, restart, protocol probe and immediate re-enable passed");
    Ok(())
}
pub fn run() {
    let root = std::env::temp_dir().join(format!("projects-runner-mcp-smoke-{}", Uuid::new_v4()));
    let cleanup = root.clone();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .setup(move |app| {
            let paths = AppPaths {
                db_path: root.join("app/test.sqlite"),
                avatars_dir: root.join("app/avatars"),
                scripts_dir: root.join("app/scripts"),
            };
            init_db(&paths)?;
            app.manage(AppState {
                paths,
                processes: Mutex::new(HashMap::new()),
                stopped_runs: Mutex::new(HashSet::new()),
                pending_prd_open_requests: Mutex::new(vec![]),
                twofa_vault: Arc::new(twofa::VaultService::new()),
                terminal_supervisor: Arc::new(terminal_supervisor::TerminalSupervisor::new()),
            });
            app.manage(McpService::default());
            app.manage(crate::data_sync::SyncService::default());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = checks(handle.clone(), root).await;
                match result {
                    Ok(()) => {
                        eprintln!("MCP integration checks passed");
                        EXIT.store(0, Ordering::SeqCst);
                    }
                    Err(error) => eprintln!("MCP integration checks failed: {error}"),
                };
                handle
                    .state::<AppState>()
                    .terminal_supervisor
                    .terminate_all();
                let runs: Vec<_> = handle
                    .state::<AppState>()
                    .processes
                    .lock()
                    .unwrap()
                    .keys()
                    .copied()
                    .collect();
                for id in runs {
                    let _ = stop_command(id, handle.clone(), handle.state()).await;
                }
                handle.exit(EXIT.load(Ordering::SeqCst));
            });
            Ok(())
        })
        .build(context)
        .expect("build isolated integration app");
    app.run_return(|_, _| {});
    let _ = fs::remove_dir_all(cleanup);
    std::process::exit(EXIT.load(Ordering::SeqCst));
}
