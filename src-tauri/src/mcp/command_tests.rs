use super::super::{commands, store, tools, types::*};
use super::Fixture;
use crate::{connect, ProjectCommand};
use diesel::{connection::SimpleConnection, prelude::*, sql_query};
use rmcp::model::CallToolResult;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Barrier, Mutex,
};

const SECRET: &str = "FIXTURE_SCRIPT_SECRET_DO_NOT_RETURN";
const MODES: [&str; 3] = [
    "internal_headless",
    "internal_interactive",
    "external_terminal",
];

fn setup(permissions: &[&str], scope: &str) -> (Fixture, McpClient, Mutex<()>) {
    let f = Fixture::new();
    store::save_settings(
        &f.0,
        &McpSettings {
            enabled: true,
            port: 6811,
        },
    )
    .unwrap();
    connect(&f.0).unwrap().batch_execute(&format!(
        "INSERT INTO commands(id,project_id,name,script,created_at,updated_at) VALUES(1,1,'Fixture','{SECRET}','created','updated');"
    )).unwrap();
    let token = store::create(&f.0, "Fixture client".into()).unwrap();
    let client = store::update(
        &f.0,
        &token.client.id,
        f.update(&token.client, permissions, scope),
    )
    .unwrap();
    (f, client, Mutex::new(()))
}

fn saved_command(f: &Fixture) -> ProjectCommand {
    sql_query("SELECT * FROM commands WHERE id=1")
        .get_result(&mut connect(&f.0).unwrap())
        .unwrap()
}

// Only the JSON Schema keywords used by the command response are needed here.
// This validates real result values against the schema exposed by tools/list.
fn matches_schema(schema: &Value, value: &Value) -> bool {
    if let Some(branches) = schema["oneOf"].as_array() {
        return branches
            .iter()
            .filter(|branch| matches_schema(branch, value))
            .count()
            == 1;
    }
    if schema
        .get("const")
        .is_some_and(|expected| expected != value)
    {
        return false;
    }
    if let Some(kinds) = schema["type"].as_array() {
        return kinds
            .iter()
            .any(|kind| matches_schema(&json!({"type":kind}), value));
    }
    match schema["type"].as_str() {
        Some("object") => {
            let Some(object) = value.as_object() else {
                return false;
            };
            if schema["required"].as_array().is_some_and(|required| {
                required
                    .iter()
                    .any(|key| !object.contains_key(key.as_str().unwrap()))
            }) {
                return false;
            }
            object
                .iter()
                .all(|(key, field)| match schema["properties"].get(key) {
                    Some(property) => matches_schema(property, field),
                    None => schema["additionalProperties"] != false,
                })
        }
        Some("integer") => value.is_i64() || value.is_u64(),
        Some("string") => value.is_string(),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        _ => false,
    }
}

fn update_schema() -> Value {
    let tool = tools::definitions()
        .into_iter()
        .find(|tool| tool.name == "commands_update")
        .unwrap();
    Value::Object(tool.output_schema.unwrap().as_ref().clone())
}

#[test]
fn update_response_respects_read_permission_for_every_patch_and_transport_field() {
    let schema = update_schema();
    for can_read in [false, true] {
        for patch in [
            json!({}),
            json!({"name":"Renamed"}),
            json!({"script":"REPLACEMENT_FIXTURE_SECRET"}),
            json!({"project_id":2}),
        ] {
            let permissions = if can_read {
                vec!["commands.update", "commands.read"]
            } else {
                vec!["commands.update"]
            };
            let (f, client, gate) = setup(&permissions, "all");
            let result = commands::update(&f.0, &gate, &client, 1, &patch).unwrap();
            assert!(matches_schema(&schema, &result));
            let command = saved_command(&f);
            assert_eq!(command.name, patch["name"].as_str().unwrap_or("Fixture"));
            assert_eq!(command.script, patch["script"].as_str().unwrap_or(SECRET));
            assert_eq!(
                command.project_id,
                patch["project_id"].as_i64().unwrap_or(1)
            );
            let wire = serde_json::to_value(CallToolResult::structured(result.clone())).unwrap();
            assert_eq!(wire["structuredContent"], result);
            assert_eq!(
                serde_json::from_str::<Value>(wire["content"][0]["text"].as_str().unwrap())
                    .unwrap(),
                result
            );
            if can_read {
                assert_eq!(result["script"], command.script);
                assert_eq!(result["id"], 1);
            } else {
                assert_eq!(result, json!({"command_id":1,"updated":true}));
                let encoded = wire.to_string();
                assert!(!encoded.contains(SECRET));
                assert!(!encoded.contains("REPLACEMENT_FIXTURE_SECRET"));
                assert!(!encoded.contains("script"));
            }
        }
    }
    assert!(!matches_schema(
        &schema,
        &json!({"command_id":1,"updated":true,"script":SECRET})
    ));
    assert!(!matches_schema(
        &schema,
        &json!({"command_id":1,"updated":false})
    ));
    assert!(!matches_schema(&schema, &json!({"command_id":1})));
}

#[test]
fn update_uses_current_policy_instead_of_request_baseline() {
    for initially_readable in [false, true] {
        let initial = if initially_readable {
            vec!["commands.update", "commands.read"]
        } else {
            vec!["commands.update"]
        };
        let next = if initially_readable {
            vec!["commands.update"]
        } else {
            vec!["commands.update", "commands.read"]
        };
        let (f, baseline, gate) = setup(&initial, "selected");
        commands::with_operation(&gate, || {
            store::update(&f.0, &baseline.id, f.update(&baseline, &next, "selected"))
        })
        .unwrap();
        let result = commands::update(&f.0, &gate, &baseline, 1, &json!({"command_id":1})).unwrap();
        assert_eq!(result.get("script").is_some(), !initially_readable);
    }
}

#[test]
fn update_checks_both_source_and_destination_without_mutating_out_of_scope_commands() {
    for source_allowed in [false, true] {
        let (f, client, gate) = setup(&["commands.update"], "selected");
        if !source_allowed {
            connect(&f.0)
                .unwrap()
                .batch_execute("UPDATE commands SET project_id=2 WHERE id=1")
                .unwrap();
        }
        let before = serde_json::to_value(saved_command(&f)).unwrap();
        let patch = json!({"name":"Must not change","project_id":if source_allowed {2} else {1}});
        assert_eq!(
            commands::update(&f.0, &gate, &client, 1, &patch)
                .unwrap_err()
                .code,
            "NOT_FOUND"
        );
        assert_eq!(serde_json::to_value(saved_command(&f)).unwrap(), before);
    }
}

fn revoke(f: &Fixture, gate: &Mutex<()>, baseline: &McpClient, action: usize) {
    commands::with_operation(gate, || {
        match action {
            0..=2 => {
                let current = store::client(&f.0, &baseline.id)?;
                let permissions = if action == 0 {
                    vec![]
                } else {
                    vec!["commands.execute"]
                };
                let mut update = f.update(&current, &permissions, "selected");
                if action == 1 {
                    update.project_ids.clear();
                }
                if action == 2 {
                    update.enabled = false;
                }
                store::update(&f.0, &current.id, update)?;
            }
            3 => store::remove(&f.0, &baseline.id)?,
            4 => {
                store::rotate(&f.0, &baseline.id)?;
            }
            5 => store::save_settings(
                &f.0,
                &McpSettings {
                    enabled: false,
                    port: 6811,
                },
            )?,
            6 => {
                connect(&f.0)?
                    .batch_execute("UPDATE commands SET project_id=2 WHERE id=1")
                    .map_err(|e| e.to_string())?;
            }
            _ => unreachable!(),
        }
        Ok(())
    })
    .unwrap();
}

fn fake_spawn(f: &Fixture, command: ProjectCommand) -> Result<String> {
    connect(&f.0)?
        .batch_execute(&format!(
            "UPDATE commands SET run_count=run_count+1 WHERE id={};
         INSERT INTO command_runs(command_id,status,started_at) VALUES({},'running','fixture');",
            command.id, command.id,
        ))
        .map_err(|e| e.to_string())?;
    std::fs::write(
        f.0.scripts_dir.join("fixture-spawn"),
        b"dummy process started",
    )
    .map_err(|e| e.to_string())?;
    Ok(command.runtime_mode)
}

fn run_count(f: &Fixture) -> usize {
    sql_query("SELECT * FROM command_runs")
        .load::<crate::CommandRun>(&mut connect(&f.0).unwrap())
        .unwrap()
        .len()
}

#[test]
fn restart_rejects_revocation_after_wait_before_any_launch_side_effect() {
    for mode in MODES {
        for action in 0..7 {
            let (f, client, gate) = setup(&["commands.execute"], "selected");
            connect(&f.0).unwrap().batch_execute(&format!(
                "UPDATE commands SET runtime_mode='{mode}', run_count=1 WHERE id=1;
                 INSERT INTO command_runs(command_id,status,started_at) VALUES(1,'running','prior');"
            )).unwrap();
            let ready = Barrier::new(2);
            let release = Barrier::new(2);
            let spawned = AtomicBool::new(false);
            std::thread::scope(|scope| {
                let restart = scope.spawn(|| {
                    commands::start_with(
                        &f.0,
                        &gate,
                        &client,
                        1,
                        || {
                            // Simulate the existing stop completing, then pause before launch.
                            connect(&f.0)?
                                .batch_execute(
                                    "UPDATE command_runs SET status='stopped' WHERE command_id=1",
                                )
                                .map_err(|e| e.to_string())?;
                            ready.wait();
                            release.wait();
                            Ok(())
                        },
                        |command, _| {
                            spawned.store(true, Ordering::SeqCst);
                            fake_spawn(&f, command)
                        },
                    )
                });
                ready.wait();
                // Also proves the restart wait is outside command_operations.
                revoke(&f, &gate, &client, action);
                release.wait();
                let error = restart.join().unwrap().unwrap_err();
                assert_eq!(
                    error.code,
                    if action == 1 || action == 6 {
                        "NOT_FOUND"
                    } else {
                        "PERMISSION_DENIED"
                    }
                );
            });
            assert!(!spawned.load(Ordering::SeqCst));
            assert_eq!(saved_command(&f).run_count, 1);
            assert_eq!(run_count(&f), 1);
            let previous = sql_query("SELECT * FROM command_runs")
                .get_result::<crate::CommandRun>(&mut connect(&f.0).unwrap())
                .unwrap();
            assert_eq!(previous.status, "stopped");
            assert_eq!(std::fs::read_dir(&f.0.scripts_dir).unwrap().count(), 0);
        }
    }
}

#[test]
fn start_and_restart_use_latest_command_project_and_runtime() {
    for restart in [false, true] {
        for mode in MODES {
            let (f, client, gate) = setup(&["commands.execute"], "all");
            let observed = commands::start_with(
                &f.0, &gate, &client, 1,
                || {
                    if restart {
                        connect(&f.0)?.batch_execute(&format!("UPDATE commands SET runtime_mode='{mode}', project_id=2, script='LATEST_SCRIPT' WHERE id=1")).map_err(|e| e.to_string())?;
                    } else {
                        connect(&f.0)?.batch_execute(&format!("UPDATE commands SET runtime_mode='{mode}' WHERE id=1")).map_err(|e| e.to_string())?;
                    }
                    Ok(())
                },
                |command, project| {
                    assert_eq!(project.id, if restart {2} else {1});
                    assert_eq!(command.script, if restart {"LATEST_SCRIPT"} else {SECRET});
                    fake_spawn(&f, command)
                },
            ).unwrap();
            assert_eq!(observed, mode);
            assert_eq!(saved_command(&f).run_count, 1);
            assert_eq!(run_count(&f), 1);
        }
    }
}

#[test]
fn launch_wins_gate_before_revocation_and_existing_run_is_preserved() {
    for action in 0..7 {
        let (f, client, gate) = setup(&["commands.execute"], "selected");
        let spawned = Barrier::new(2);
        let release = Barrier::new(2);
        let revoke_entered = Barrier::new(2);
        std::thread::scope(|scope| {
            let launch = scope.spawn(|| {
                commands::start_with(
                    &f.0,
                    &gate,
                    &client,
                    1,
                    || Ok(()),
                    |command, _| {
                        let result = fake_spawn(&f, command)?;
                        spawned.wait();
                        release.wait();
                        Ok(result)
                    },
                )
            });
            spawned.wait();
            assert!(gate.try_lock().is_err());
            let revocation = scope.spawn(|| {
                revoke_entered.wait();
                revoke(&f, &gate, &client, action);
            });
            revoke_entered.wait();
            release.wait();
            assert!(launch.join().unwrap().is_ok());
            revocation.join().unwrap();
        });
        assert_eq!(saved_command(&f).run_count, 1);
        assert_eq!(run_count(&f), 1);
        let running = sql_query("SELECT * FROM command_runs")
            .get_result::<crate::CommandRun>(&mut connect(&f.0).unwrap())
            .unwrap();
        assert_eq!(running.status, "running");
        assert!(f.0.scripts_dir.join("fixture-spawn").is_file());
    }
}

#[test]
fn failed_restart_wait_does_not_spawn_or_change_runtime_counters() {
    let (f, client, gate) = setup(&["commands.execute"], "selected");
    let result = commands::start_with(
        &f.0,
        &gate,
        &client,
        1,
        || {
            Err(McpError::new(
                "COMMAND_RUNNING",
                "The previous run is still stopping.",
            ))
        },
        |command, _| fake_spawn(&f, command),
    );
    assert_eq!(result.unwrap_err().code, "COMMAND_RUNNING");
    assert_eq!(saved_command(&f).run_count, 0);
    assert_eq!(run_count(&f), 0);
    assert_eq!(std::fs::read_dir(&f.0.scripts_dir).unwrap().count(), 0);
}
