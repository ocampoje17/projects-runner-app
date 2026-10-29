use super::{commands, notes, policy, types::*};
use crate::*;
use rmcp::model::Tool;
use serde_json::{json, Value};
use tauri::Manager;

const SPECS:&[(&str,&str,&str,&[&str])]=&[
 ("projects_list","projects.read","List permitted projects; excludes notes.",&[]),
 ("projects_get","projects.read","Read project metadata; excludes notes.",&["project_id"]),
 ("projects_create","projects.create","Create a project at an existing absolute directory.",&["name","path"]),
 ("projects_update","projects.update","Patch project metadata without modifying notes.",&["project_id"]),
 ("projects_delete","projects.delete","Delete project and its commands/notes; preserve 2FA accounts. Stop runs first.",&["project_id"]),
 ("commands_list","commands.read","List commands in a permitted project.",&["project_id"]),
 ("commands_get","commands.read","Read a saved command and runtime configuration.",&["command_id"]),
 ("commands_create","commands.create","Create a saved command. Executing requires separate permission.",&["project_id","name","script"]),
 ("commands_update","commands.update","Patch a saved command; source and destination projects must be permitted. Returns the command with commands.read, otherwise only command_id and updated.",&["command_id"]),
 ("commands_delete","commands.delete","Delete a stopped command.",&["command_id"]),
 ("command_sections_list","commands.read","List command sections.",&["project_id"]),
 ("command_sections_create","commands.create","Create a command section.",&["project_id","name"]),
 ("command_sections_update","commands.update","Rename a command section and its command memberships.",&["section_id","name"]),
 ("command_sections_delete","commands.delete","Delete an empty command section.",&["section_id"]),
 ("commands_start","commands.execute","Start a saved command using its configured runtime; does not accept a script.",&["command_id"]),
 ("commands_stop","commands.execute","Stop a run; already completed runs are unchanged.",&["run_id"]),
 ("commands_restart","commands.execute","Stop the current run, wait for exit, then start the saved command.",&["command_id"]),
 ("runs_list","commands.read","List runs in permitted projects.",&[]),
 ("runs_get","commands.read","Get run state and exit code.",&["run_id"]),
 ("runs_read_output","commands.output.read","Read bounded output. Cursor is a byte offset; truncated signals discarded history.",&["run_id"]),
 ("notes_list","notes.read","List project notes and versions.",&["project_id"]),
 ("notes_get","notes.read","Get one note and its version.",&["project_id","note_id"]),
 ("notes_create","notes.create","Create a note without replacing other notes.",&["project_id","title","content"]),
 ("notes_update","notes.update","Patch one note. Use version from the last read.",&["project_id","note_id","expected_version"]),
 ("notes_delete","notes.delete","Delete one note if its version still matches.",&["project_id","note_id","expected_version"]),
 ("twofa_accounts_list","twofa.accounts.read","List only granted 2FA account labels. Unlock vault in app first.",&[]),
 ("twofa_get_code","twofa.codes.read","Get current OTP for one granted account. Does not unlock or extend vault activity.",&["account_id"]),
 ("sync_get_status","sync.read","Read Data Sync readiness and configured scopes.",&[]),
 ("sync_start","sync.run","Start configured Data Sync. Resolve project matches/conflicts in app. Poll job for completion.",&[]),
 ("sync_get_job","sync.run","Read your sync job without exposing snapshot/conflict contents.",&["job_id"]),
];
pub fn permission(name: &str) -> &str {
    SPECS
        .iter()
        .find(|s| s.0 == name)
        .map(|s| s.1)
        .unwrap_or("__unknown")
}
fn keys(name: &str) -> Vec<&'static str> {
    let mut k = SPECS
        .iter()
        .find(|s| s.0 == name)
        .map(|s| s.3.to_vec())
        .unwrap_or_default();
    if name.ends_with("_list") {
        k.extend(["search", "offset", "limit"]);
    }
    match name {
        "projects_create" => k.extend(["description"]),
        "projects_update" => k.extend(["name", "path", "description"]),
        "commands_create" | "commands_update" => k.extend([
            "project_id",
            "name",
            "script",
            "ports",
            "section",
            "order_index",
            "runtime_mode",
            "external_terminal_kind",
            "interactive_terminal_kind",
        ]),
        "command_sections_create" => k.push("order_index"),
        "runs_list" => k.extend(["project_id", "command_id"]),
        "runs_read_output" => k.extend(["cursor", "limit"]),
        "notes_create" => k.push("pinned"),
        "notes_update" => k.extend(["title", "content", "pinned"]),
        _ => {}
    }
    k.sort();
    k.dedup();
    k
}
pub fn definitions() -> Vec<Tool> {
    SPECS.iter().map(|(name, permission, description, required)| {
        let mut props = serde_json::Map::new();
        for k in keys(name) {
            let schema = match k {
                "limit" => json!({"type":"integer","minimum":1,"maximum":if *name=="runs_read_output"{65536}else{200},"default":if *name=="runs_read_output"{65536}else{50}}),
                "offset" | "order_index" => json!({"type":"integer","minimum":0}),
                "ports" => json!({"type":"array","items":{"type":"integer","minimum":1,"maximum":65535}}),
                "pinned" => json!({"type":"boolean"}),
                "runtime_mode" => json!({"type":"string","enum":[RUNTIME_MODE_INTERNAL_HEADLESS,RUNTIME_MODE_INTERNAL_INTERACTIVE,RUNTIME_MODE_EXTERNAL_TERMINAL]}),
                "path" => json!({"type":"string","description":"Existing absolute project directory on this computer."}),
                "expected_version" => json!({"type":"string","description":"Version returned by the last note read; stale edits return CONFLICT."}),
                "cursor" => json!({"type":"string","description":"next_cursor from the previous page; omit for oldest retained output."}),
                k if k.ends_with("_id") && !["note_id","account_id","job_id"].contains(&k) => json!({"type":"integer","minimum":1}),
                _ => json!({"type":"string"}),
            };
            props.insert(k.into(), schema);
        }
        let mut t = Tool::default();
        t.name = (*name).to_string().into();
        t.description = Some(format!("{description} Required permission: {permission}.").into());
        t.input_schema = Arc::new(json!({"type":"object","properties":props,"required":required,"additionalProperties":false}).as_object().unwrap().clone());
        t.output_schema = Some(Arc::new(output_schema(name).as_object().unwrap().clone()));
        t
    }).collect()
}
fn object_schema(fields: &[(&str, &str)]) -> Value {
    let properties: serde_json::Map<String, Value> = fields
        .iter()
        .map(|(name, kind)| {
            let kind = if let Some(kind) = kind.strip_suffix('?') {
                json!([kind, "null"])
            } else {
                json!(kind)
            };
            ((*name).into(), json!({"type":kind}))
        })
        .collect();
    json!({"type":"object","properties":properties})
}
fn output_schema(name: &str) -> Value {
    let item = if name.starts_with("projects_") {
        object_schema(&[
            ("id", "integer"),
            ("name", "string"),
            ("path", "string"),
            ("description", "string?"),
            ("created_at", "string"),
            ("updated_at", "string"),
        ])
    } else if name.starts_with("command_sections_") {
        object_schema(&[
            ("id", "integer"),
            ("project_id", "integer"),
            ("name", "string"),
            ("order_index", "integer"),
            ("created_at", "string"),
            ("updated_at", "string"),
        ])
    } else if name.starts_with("notes_") {
        object_schema(&[
            ("id", "string"),
            ("title", "string"),
            ("content", "string"),
            ("pinned", "boolean"),
            ("createdAt", "string"),
            ("updatedAt", "string"),
            ("version", "string"),
        ])
    } else if name.starts_with("twofa_accounts_") {
        object_schema(&[
            ("id", "string"),
            ("issuer", "string"),
            ("account", "string"),
        ])
    } else if name.starts_with("runs_") {
        object_schema(&[
            ("id", "integer"),
            ("command_id", "integer"),
            ("status", "string"),
            ("started_at", "string"),
            ("ended_at", "string?"),
            ("exit_code", "integer?"),
        ])
    } else {
        object_schema(&[
            ("id", "integer"),
            ("project_id", "integer"),
            ("name", "string"),
            ("script", "string"),
            ("ports", "string"),
            ("section", "string"),
            ("order_index", "integer"),
            ("runtime_mode", "string"),
            ("run_in_external_terminal", "integer"),
            ("external_terminal_kind", "string"),
            ("interactive_terminal_kind", "string"),
            ("run_count", "integer"),
            ("avatar_path", "string?"),
            ("created_at", "string"),
            ("updated_at", "string"),
        ])
    };
    if name.ends_with("_delete") {
        return object_schema(&[("deleted", "boolean")]);
    }
    if name.ends_with("_list") {
        return json!({"type":"object","properties":{"items":{"type":"array","items":item},"has_more":{"type":"boolean"}},"required":["items","has_more"]});
    }
    match name {
        "commands_update" => {
            let mut command = item;
            command["required"] = json!(["id", "project_id", "script"]);
            json!({
                "type":"object",
                "oneOf":[
                    command,
                    {
                        "type":"object",
                        "properties":{
                            "command_id":{"type":"integer"},
                            "updated":{"type":"boolean","const":true}
                        },
                        "required":["command_id","updated"],
                        "additionalProperties":false
                    }
                ]
            })
        }
        "commands_start" | "commands_restart" => object_schema(&[
            ("run_id", "integer"),
            ("command_id", "integer"),
            ("runtime_mode", "string"),
            ("terminal_session_id", "string?"),
            ("status", "string"),
            ("output_available", "boolean"),
        ]),
        "commands_stop" => object_schema(&[("run_id", "integer"), ("status", "string")]),
        "runs_read_output" => object_schema(&[
            ("text", "string"),
            ("next_cursor", "string"),
            ("truncated", "boolean"),
            ("ended", "boolean"),
        ]),
        "twofa_get_code" => object_schema(&[
            ("account_id", "string"),
            ("code", "string"),
            ("server_time", "integer"),
            ("valid_until", "integer"),
            ("remaining_seconds", "integer"),
            ("period", "integer"),
        ]),
        "sync_start" | "sync_get_job" => object_schema(&[
            ("id", "string"),
            ("state", "string"),
            ("error_code", "string?"),
            ("created_at", "string"),
        ]),
        "sync_get_status" => object_schema(&[
            ("configured", "boolean"),
            ("scopes", "object"),
            ("last_synced_at", "string?"),
            ("busy", "boolean"),
        ]),
        _ => item,
    }
}
fn invalid(msg: &str) -> McpError {
    McpError::new("INVALID_ARGUMENT", msg)
}
fn id(v: &Value, key: &str) -> types::Result<i64> {
    v[key]
        .as_i64()
        .filter(|v| *v > 0)
        .ok_or_else(|| invalid("A positive resource ID is required."))
}
fn text<'a>(v: &'a Value, key: &str) -> types::Result<&'a str> {
    v[key]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| invalid("A required text field is missing."))
}
fn val<T: Serialize>(v: T) -> types::Result<Value> {
    serde_json::to_value(v).map_err(|e| e.to_string().into())
}
fn page(mut values: Vec<Value>, v: &Value) -> Value {
    if let Some(search) = v["search"].as_str() {
        let q = search.to_lowercase();
        values.retain(|v| v.to_string().to_lowercase().contains(&q));
    }
    let limit = v["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
    let offset = v["offset"].as_u64().unwrap_or(0) as usize;
    let has_more = values.len() > offset.saturating_add(limit);
    json!({"items":values.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"has_more":has_more})
}
fn project_value(p: Project) -> Value {
    json!({"id":p.id,"name":p.name,"path":p.path,"description":p.description,"created_at":p.created_at,"updated_at":p.updated_at})
}
fn project_record(state: &AppState, c: &McpClient, pid: i64) -> types::Result<Project> {
    policy::project(c, pid)?;
    sql_query(format!("SELECT * FROM projects WHERE id={pid}"))
        .get_result::<Project>(&mut connect(&state.paths)?)
        .map_err(|_| McpError::new("NOT_FOUND", "Project not found."))
}
fn command_record(state: &AppState, c: &McpClient, cid: i64) -> types::Result<ProjectCommand> {
    let row = sql_query(format!("SELECT * FROM commands WHERE id={cid}"))
        .get_result::<ProjectCommand>(&mut connect(&state.paths)?)
        .map_err(|_| McpError::new("NOT_FOUND", "Command not found."))?;
    policy::project(c, row.project_id)?;
    Ok(row)
}
fn run_record(state: &AppState, c: &McpClient, rid: i64) -> types::Result<CommandRun> {
    let r = sql_query(format!("SELECT * FROM command_runs WHERE id={rid}"))
        .get_result::<CommandRun>(&mut connect(&state.paths)?)
        .map_err(|_| McpError::new("NOT_FOUND", "Run not found."))?;
    command_record(state, c, r.command_id)?;
    Ok(r)
}
fn running(state: &AppState, cid: i64) -> bool {
    state
        .terminal_supervisor
        .get_session_by_command(cid)
        .is_some()
        || connect(&state.paths).ok().is_none_or(|mut conn| {
            sql_query(format!(
                "SELECT * FROM command_runs WHERE command_id={cid} AND status='running'"
            ))
            .load::<CommandRun>(&mut conn)
            .map_or(true, |v| !v.is_empty())
        })
}
fn validate(name: &str, v: &Value) -> types::Result<()> {
    let spec = SPECS
        .iter()
        .find(|s| s.0 == name)
        .ok_or_else(|| invalid("Unknown tool."))?;
    let object = v
        .as_object()
        .ok_or_else(|| invalid("Expected an argument object."))?;
    let allowed = keys(name);
    if object.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(invalid("Unknown argument."));
    }
    for k in spec.3 {
        if k.ends_with("_id") && !["note_id", "account_id", "job_id"].contains(k) {
            id(v, k)?;
        } else {
            text(v, k)?;
        }
    }
    for (k, x) in object {
        if k.ends_with("_id") && !["note_id", "account_id", "job_id"].contains(&k.as_str()) {
            id(v, k)?;
        } else if ["limit", "offset", "order_index"].contains(&k.as_str()) {
            if x.as_u64().is_none() {
                return Err(invalid("Invalid numeric argument."));
            }
        } else if k == "pinned" {
            if !x.is_boolean() {
                return Err(invalid("Invalid boolean."));
            }
        } else if k == "ports" {
            if !x.as_array().is_some_and(|v| {
                v.iter()
                    .all(|p| p.as_u64().is_some_and(|p| p > 0 && p <= 65535))
            }) {
                return Err(invalid("Invalid ports."));
            }
        } else if !x.is_string() {
            return Err(invalid("Invalid text argument."));
        }
    }
    if let Some(p) = v["path"].as_str() {
        if !Path::new(p).is_absolute() || !Path::new(p).is_dir() {
            return Err(invalid(
                "Project path must be an existing absolute directory.",
            ));
        }
    }
    if let Some(mode) = v["runtime_mode"].as_str() {
        if ![
            RUNTIME_MODE_INTERNAL_HEADLESS,
            RUNTIME_MODE_INTERNAL_INTERACTIVE,
            RUNTIME_MODE_EXTERNAL_TERMINAL,
        ]
        .contains(&mode)
        {
            return Err(invalid("Invalid runtime mode."));
        }
    }
    Ok(())
}
pub fn execute(app: &AppHandle, c: &McpClient, name: &str, v: Value) -> types::Result<Value> {
    validate(name, &v)?;
    policy::permission(c, permission(name))?;
    let state = app.state::<AppState>();
    let mut changed = false;
    let result = match name {
        "projects_list" => page(
            list_projects(app.state())?
                .into_iter()
                .filter(|p| policy::project(c, p.id).is_ok())
                .map(project_value)
                .collect(),
            &v,
        ),
        "projects_get" => project_value(project_record(&state, c, id(&v, "project_id")?)?),
        "projects_create" => {
            let mut conn = connect(&state.paths)?;
            conn.batch_execute("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            let r = (|| {
                let now = now();
                sql_query("INSERT INTO projects(name,path,description,created_at,updated_at) VALUES(?,?,?,?,?)").bind::<Text,_>(text(&v,"name")?).bind::<Text,_>(text(&v,"path")?).bind::<Nullable<Text>,_>(v["description"].as_str()).bind::<Text,_>(&now).bind::<Text,_>(&now).execute(&mut conn).map_err(|e|e.to_string())?;
                let p = sql_query("SELECT * FROM projects WHERE id=last_insert_rowid()")
                    .get_result::<Project>(&mut conn)
                    .map_err(|e| e.to_string())?;
                ensure_command_section(&mut conn, p.id, "General", Some(-1))?;
                if c.project_scope == "selected" {
                    sql_query("INSERT INTO mcp_client_projects VALUES(?,?)")
                        .bind::<Text, _>(&c.id)
                        .bind::<BigInt, _>(p.id)
                        .execute(&mut conn)
                        .map_err(|e| e.to_string())?;
                    sql_query("UPDATE mcp_clients SET value=json_set(value,'$.policy_revision',json_extract(value,'$.policy_revision')+1,'$.updated_at',?) WHERE id=?")
                        .bind::<Text,_>(&now).bind::<Text,_>(&c.id).execute(&mut conn).map_err(|e|e.to_string())?;
                }
                Ok::<_, McpError>(project_value(p))
            })();
            match r {
                Ok(p) => {
                    conn.batch_execute("COMMIT").map_err(|e| e.to_string())?;
                    changed = true;
                    p
                }
                Err(e) => {
                    let _ = conn.batch_execute("ROLLBACK");
                    return Err(e);
                }
            }
        }
        "projects_update" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            let mut patch = v.clone();
            patch.as_object_mut().unwrap().remove("project_id");
            let mut p = notes::project_metadata_update(pid, patch, app.state())?;
            p.as_object_mut().unwrap().remove("notes");
            p.as_object_mut().unwrap().remove("avatar_path");
            changed = true;
            p
        }
        "projects_delete" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            let _operation = state
                .terminal_supervisor
                .command_operations
                .lock()
                .map_err(|_| McpError::new("INTERNAL_ERROR", "Runtime unavailable."))?;
            let mut conn = connect(&state.paths)?;
            conn.batch_execute("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            let result = (|| {
                let commands = sql_query(format!("SELECT * FROM commands WHERE project_id={pid}"))
                    .load::<ProjectCommand>(&mut conn)
                    .map_err(|e| e.to_string())?;
                if !commands.is_empty() {
                    policy::permission(c, "commands.delete")?;
                }
                if commands.iter().any(|cmd| running(&state, cmd.id)) {
                    return Err(McpError::new(
                        "COMMAND_RUNNING",
                        "Stop project commands before deleting.",
                    ));
                }
                if !notes::load(&mut conn, pid)?.is_empty() {
                    policy::permission(c, "notes.delete")?;
                }
                sql_query("DELETE FROM twofa_account_projects WHERE project_id=?")
                    .bind::<BigInt, _>(pid)
                    .execute(&mut conn)
                    .map_err(|e| e.to_string())?;
                sql_query("DELETE FROM projects WHERE id=?")
                    .bind::<BigInt, _>(pid)
                    .execute(&mut conn)
                    .map_err(|e| e.to_string())?;
                Ok::<_, McpError>(())
            })();
            if let Err(e) = result {
                let _ = conn.batch_execute("ROLLBACK");
                return Err(e);
            }
            conn.batch_execute("COMMIT").map_err(|e| e.to_string())?;
            changed = true;
            json!({"deleted":true})
        }
        "commands_list" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            page(
                list_commands(pid, app.state())?
                    .into_iter()
                    .map(|x| serde_json::to_value(x).unwrap())
                    .collect(),
                &v,
            )
        }
        "commands_get" => val(command_record(&state, c, id(&v, "command_id")?)?)?,
        "commands_create" => {
            project_record(&state, c, id(&v, "project_id")?)?;
            let input: CommandInput =
                serde_json::from_value(v.clone()).map_err(|_| invalid("Invalid command fields."))?;
            let cmd = create_command(input, app.state())?;
            changed = true;
            val(cmd)?
        }
        "commands_update" => {
            let result = commands::update(
                &state.paths,
                &state.terminal_supervisor.command_operations,
                c,
                id(&v, "command_id")?,
                &v,
            )?;
            changed = true;
            result
        }
        "commands_delete" => {
            let cid = id(&v, "command_id")?;
            command_record(&state, c, cid)?;
            if running(&state, cid) {
                return Err(McpError::new("COMMAND_RUNNING", "Stop this command first."));
            }
            delete_command(cid, app.state())?;
            changed = true;
            json!({"deleted":true})
        }
        "command_sections_list" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            page(
                list_command_sections(pid, app.state())?
                    .into_iter()
                    .map(|x| serde_json::to_value(x).unwrap())
                    .collect(),
                &v,
            )
        }
        "command_sections_create" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            let section = create_command_section(
                CommandSectionInput {
                    project_id: pid,
                    name: text(&v, "name")?.into(),
                    order_index: v["order_index"].as_i64().map(|n| n as i32),
                },
                app.state(),
            )?;
            changed = true;
            val(section)?
        }
        "command_sections_update" | "command_sections_delete" => {
            let sid = id(&v, "section_id")?;
            let mut conn = connect(&state.paths)?;
            let section = sql_query(format!("SELECT * FROM command_sections WHERE id={sid}"))
                .get_result::<CommandSection>(&mut conn)
                .map_err(|_| McpError::new("NOT_FOUND", "Section not found."))?;
            policy::project(c, section.project_id)?;
            changed = true;
            if name.ends_with("update") {
                val(rename_command_section(
                    sid,
                    CommandSectionUpdateInput {
                        name: text(&v, "name")?.into(),
                    },
                    app.state(),
                )?)?
            } else {
                delete_command_section(sid, app.state())?;
                json!({"deleted":true})
            }
        }
        "notes_list" | "notes_get" | "notes_create" | "notes_update" | "notes_delete" => {
            let pid = id(&v, "project_id")?;
            project_record(&state, c, pid)?;
            let action = name.strip_prefix("notes_").unwrap();
            if action == "list" || action == "get" {
                let mut items = notes::load(&mut connect(&state.paths)?, pid)?;
                for n in &mut items {
                    n["version"] = json!(notes::version(n));
                }
                if action == "list" {
                    page(items, &v)
                } else {
                    items
                        .into_iter()
                        .find(|n| n["id"].as_str() == v["note_id"].as_str())
                        .ok_or_else(|| McpError::new("NOT_FOUND", "Note not found."))?
                }
            } else {
                changed = true;
                notes::mutate(&state.paths, pid, action, v.clone())?
            }
        }
        "commands_start" | "commands_restart" => {
            let cid = id(&v, "command_id")?;
            command_record(&state, c, cid)?;
            val(commands::start(app, c, cid, || {
                if name != "commands_restart" {
                    return Ok(());
                }
                let runs = sql_query(format!(
                    "SELECT * FROM command_runs WHERE command_id={cid} AND status='running'"
                ))
                .load::<CommandRun>(&mut connect(&state.paths)?)
                .map_err(|e| e.to_string())?;
                for run in runs {
                    stop(app, run.id, c)?;
                }
                let end = std::time::Instant::now() + std::time::Duration::from_secs(15);
                while running(&state, cid) {
                    if std::time::Instant::now() > end {
                        return Err(McpError::new(
                            "COMMAND_RUNNING",
                            "The previous run is still stopping.",
                        ));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Ok(())
            })?)?
        }
        "commands_stop" => {
            let rid = id(&v, "run_id")?;
            stop(app, rid, c)?;
            json!({"run_id":rid,"status":run_record(&state,c,rid)?.status})
        }
        "runs_get" => val(run_record(&state, c, id(&v, "run_id")?)?)?,
        "runs_list" => {
            let mut runs = sql_query("SELECT * FROM command_runs ORDER BY id DESC")
                .load::<CommandRun>(&mut connect(&state.paths)?)
                .map_err(|e| e.to_string())?;
            runs.retain(|r| {
                command_record(&state, c, r.command_id).is_ok_and(|cmd| {
                    v["project_id"].as_i64().is_none_or(|p| p == cmd.project_id)
                        && v["command_id"].as_i64().is_none_or(|id| id == cmd.id)
                })
            });
            page(
                runs.into_iter()
                    .map(|r| serde_json::to_value(r).unwrap())
                    .collect(),
                &v,
            )
        }
        "runs_read_output" => {
            let rid = id(&v, "run_id")?;
            run_record(&state, c, rid)?;
            let service = app.state::<super::McpService>();
            let o = service.output.lock().unwrap();
            val(o.read(
                rid,
                v["cursor"].as_str(),
                v["limit"].as_u64().unwrap_or(65536) as usize,
            )?)?
        }
        "twofa_accounts_list" | "twofa_get_code" => otp(app, c, name, &v)?,
        "sync_get_status" => {
            let s = crate::data_sync::sync_get_status(app.state())?;
            json!({"configured":s.folder.is_some(),"scopes":s.scopes,"last_synced_at":s.last_synced_at,"busy":super::sync_jobs::busy(app)||crate::data_sync::is_busy(&app.state::<crate::data_sync::SyncService>())})
        }
        "sync_start" => val(super::sync_jobs::start(app, c)?)?,
        "sync_get_job" => val(super::sync_jobs::get(app, c, text(&v, "job_id")?)?)?,
        _ => return Err(invalid("Unknown tool.")),
    };
    if changed {
        let _ = app.emit("app://data-changed", json!({}));
    }
    Ok(result)
}
fn stop(app: &AppHandle, rid: i64, c: &McpClient) -> types::Result<()> {
    let state = app.state::<AppState>();
    let r = run_record(&state, c, rid)?;
    if let Some(s) = state
        .terminal_supervisor
        .get_session_by_command(r.command_id)
    {
        if s.run_id == rid {
            state
                .terminal_supervisor
                .stop_session(&s.session_id, app.clone())?;
            return Ok(());
        }
    }
    tauri::async_runtime::block_on(stop_command(rid, app.clone(), app.state()))?;
    Ok(())
}
fn otp(app: &AppHandle, c: &McpClient, name: &str, v: &Value) -> types::Result<Value> {
    let state = app.state::<AppState>();
    if name == "twofa_get_code" {
        policy::account(c, text(v, "account_id")?)?;
    }
    state.twofa_vault.process_signals_and_auto_lock(app);
    let vault = state
        .twofa_vault
        .lock()
        .map_err(|_| McpError::new("VAULT_LOCKED", "Unlock the vault in the app."))?;
    let mut conn = connect(&state.paths)?;
    if twofa::get_vault_metadata(&mut conn)?.is_none() {
        return Err(McpError::new(
            "VAULT_NOT_INITIALIZED",
            "Create the 2FA vault in the app.",
        ));
    }
    if !vault.is_unlocked() {
        return Err(McpError::new(
            "VAULT_LOCKED",
            "Unlock the 2FA vault in the app.",
        ));
    }
    let session = vault
        .session_id
        .clone()
        .ok_or_else(|| McpError::new("VAULT_LOCKED", "Unlock the vault in the app."))?;
    let mut conn = connect(&state.paths)?;
    let result = if name == "twofa_get_code" {
        let aid = text(v, "account_id")?;
        let batch = twofa::get_twofa_codes(&mut conn, &vault, Some(vec![aid.into()]), &session)?;
        let code = batch
            .codes
            .into_iter()
            .next()
            .ok_or_else(|| McpError::new("NOT_FOUND", "Account not found."))?;
        if !code.is_valid {
            return Err(McpError::new(
                "ACCOUNT_INVALID",
                "This account cannot generate an OTP.",
            ));
        }
        json!({"account_id":aid,"code":code.code,"server_time":batch.server_time,"valid_until":code.valid_until,"remaining_seconds":code.remaining_seconds,"period":code.period})
    } else {
        let key = zeroize::Zeroizing::new(twofa::get_unlocked_data_key(&vault)?);
        let mut values = vec![];
        for aid in &c.account_ids {
            if let Ok(p) = twofa::get_account_payload_internal(&mut conn, &key, aid) {
                values.push(json!({"id":aid,"issuer":p.issuer,"account":p.account}));
            }
        }
        page(values, v)
    };
    drop(vault);
    state.twofa_vault.process_signals_and_auto_lock(app);
    let vault = state
        .twofa_vault
        .lock()
        .map_err(|_| McpError::new("VAULT_LOCKED", "Unlock the vault in the app."))?;
    let fresh = policy::refresh(&state.paths, c)?;
    policy::permission(&fresh, permission(name))?;
    if name == "twofa_get_code" {
        policy::account(&fresh, text(v, "account_id")?)?;
    }
    if name == "twofa_accounts_list" {
        // Re-filter before paging: an allowlist may be revoked during decryption.
        if fresh.account_ids != c.account_ids {
            return Err(McpError::new(
                "CONFLICT",
                "Account access changed. Retry the request.",
            ));
        }
    }
    vault
        .validate_session(&session)
        .map_err(|_| McpError::new("VAULT_LOCKED", "The vault session has ended."))?;
    Ok(result)
}
use super::types;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn execution_and_otp_cannot_expand_their_inputs() {
        assert!(validate(
            "commands_start",
            &json!({"command_id":1,"script":"unexpected"})
        )
        .is_err());
        assert!(validate("twofa_get_code", &json!({"account_id":""})).is_err());
        assert!(validate("twofa_get_code", &json!({})).is_err());
        assert!(validate("twofa_get_code", &json!({"account_id":"one"})).is_ok());
        assert!(validate("projects_update", &json!({"project_id":1,"notes":"secret"})).is_err());
        assert!(validate(
            "commands_create",
            &json!({"project_id":1,"name":"one","script":"echo ok","avatar_path":"/secret"})
        )
        .is_err());
    }
    #[test]
    fn project_dto_never_contains_notes_or_avatar_paths() {
        let p = Project {
            id: 1,
            name: "one".into(),
            path: "/one".into(),
            description: None,
            notes: Some("private".into()),
            avatar_path: Some("private path".into()),
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        let value = project_value(p);
        assert!(value.get("notes").is_none() && value.get("avatar_path").is_none());
    }
}
