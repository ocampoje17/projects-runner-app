use super::{store::rows, types::*};
use crate::{connect, AppPaths};
use diesel::{prelude::*, sql_query, sql_types::Text};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
pub fn version(note: &Value) -> String {
    let value = json!([
        note["id"].as_str().unwrap_or(""),
        note["title"].as_str().unwrap_or("").trim(),
        note["content"].as_str().unwrap_or(""),
        note["pinned"].as_bool().unwrap_or(false),
        note["createdAt"].as_str().unwrap_or(""),
        note["updatedAt"].as_str().unwrap_or("")
    ]);
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}
pub fn load(conn: &mut SqliteConnection, id: i64) -> Result<Vec<Value>> {
    let p=rows(conn,&format!("SELECT json_object('notes',notes,'created_at',created_at,'updated_at',updated_at) value FROM projects WHERE id={id}"))?.into_iter().next().ok_or_else(||McpError::new("NOT_FOUND","Project not found."))?;
    let raw = p["notes"].as_str().unwrap_or("");
    let mut values: Vec<Value> = if raw.trim().is_empty() {
        vec![]
    } else if let Ok(v) = serde_json::from_str::<Vec<Value>>(raw) {
        v
    } else {
        vec![
            json!({"id":format!("legacy-{id}"),"title":raw.lines().next().unwrap_or("").trim_start_matches('#').trim(),"content":raw,"pinned":false,"createdAt":p["created_at"],"updatedAt":p["updated_at"]}),
        ]
    };
    values.retain(|v| v.is_object());
    for (i, v) in values.iter_mut().enumerate() {
        if v["id"].as_str().is_none_or(|s| s.is_empty()) {
            v["id"] = json!(format!("legacy-{id}-{i}"));
        }
        if !v["createdAt"].is_string() {
            v["createdAt"] = v
                .get("created_at")
                .cloned()
                .unwrap_or(p["created_at"].clone());
        }
        if !v["updatedAt"].is_string() {
            v["updatedAt"] = v
                .get("updated_at")
                .cloned()
                .unwrap_or(p["updated_at"].clone());
        }
        if v["title"].as_str().is_none_or(|s| s.trim().is_empty()) {
            v["title"] = json!(v["content"]
                .as_str()
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("Project Note")
                .trim_start_matches('#')
                .trim());
        }
    }
    for v in &mut values {
        if v["title"].as_str().is_none_or(|s| s.trim().is_empty()) {
            v["title"] = json!("Untitled note");
        }
    }
    Ok(values)
}
pub fn mutate(paths: &AppPaths, project_id: i64, action: &str, input: Value) -> Result<Value> {
    let mut conn = connect(paths)?;
    conn.batch_execute("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let mut notes = load(&mut conn, project_id)?;
        let id = input["note_id"].as_str().unwrap_or("");
        let output = if action == "create" {
            let title = input["title"].as_str().unwrap_or("").trim();
            let content = input["content"].as_str().unwrap_or("").trim();
            if title.is_empty() || content.is_empty() {
                return Err(McpError::new(
                    "INVALID_ARGUMENT",
                    "Note title and content are required.",
                ));
            }
            let now = crate::now();
            let n = json!({"id":format!("note-{}",uuid::Uuid::new_v4()),"title":title,"content":content,"pinned":input["pinned"].as_bool().unwrap_or(false),"createdAt":now,"updatedAt":now});
            notes.insert(0, n.clone());
            n
        } else {
            let index = notes
                .iter()
                .position(|n| n["id"].as_str() == Some(id))
                .ok_or_else(|| McpError::new("NOT_FOUND", "Note not found."))?;
            if input["expected_version"].as_str() != Some(version(&notes[index]).as_str()) {
                return Err(McpError::new(
                    "CONFLICT",
                    "Note changed. Reload before saving.",
                ));
            }
            if action == "delete" {
                notes.remove(index);
                json!({"deleted":true})
            } else {
                for key in ["title", "content", "pinned"] {
                    if let Some(v) = input.get(key) {
                        if key == "pinned" && !v.is_boolean()
                            || key == "title" && v.as_str().is_none_or(|s| s.trim().is_empty())
                            || key == "content" && !v.is_string()
                        {
                            return Err(McpError::new("INVALID_ARGUMENT", "Invalid note field."));
                        }
                        notes[index][key] = v.clone();
                    }
                }
                notes[index]["updatedAt"] = json!(crate::now());
                notes[index].clone()
            }
        };
        sql_query("UPDATE projects SET notes=?,updated_at=? WHERE id=?")
            .bind::<Text, _>(Value::Array(notes).to_string())
            .bind::<Text, _>(crate::now())
            .bind::<diesel::sql_types::BigInt, _>(project_id)
            .execute(&mut conn)
            .map_err(|e| e.to_string())?;
        let mut output = output;
        if output.get("id").is_some() {
            output["version"] = json!(version(&output));
        }
        Ok(output)
    })();
    match result {
        Ok(v) => {
            conn.batch_execute("COMMIT").map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.batch_execute("ROLLBACK");
            Err(e)
        }
    }
}
use diesel::connection::SimpleConnection;
#[tauri::command]
pub fn project_notes_list(project_id: i64, state: State<crate::AppState>) -> Result<Vec<Value>> {
    let mut values = load(&mut connect(&state.paths)?, project_id)?;
    for v in &mut values {
        v["version"] = json!(version(v));
    }
    Ok(values)
}
#[tauri::command]
pub fn project_notes_mutate(
    project_id: i64,
    action: String,
    input: Value,
    app: AppHandle,
    state: State<crate::AppState>,
) -> Result<Value> {
    if !["create", "update", "delete"].contains(&action.as_str()) {
        return Err(McpError::new("INVALID_ARGUMENT", "Invalid note action."));
    }
    let v = mutate(&state.paths, project_id, &action, input)?;
    let _ = app.emit("app://data-changed", json!({"project_id":project_id}));
    Ok(v)
}
#[tauri::command]
pub fn project_metadata_update(
    id: i64,
    patch: Value,
    state: State<crate::AppState>,
) -> Result<Value> {
    let object = patch
        .as_object()
        .ok_or_else(|| McpError::new("INVALID_ARGUMENT", "Expected metadata patch."))?;
    for (key, value) in object {
        if !["name", "path", "description", "avatar_path"].contains(&key.as_str())
            || (!value.is_null() && !value.is_string())
            || (["name", "path"].contains(&key.as_str())
                && value.as_str().is_none_or(|s| s.trim().is_empty()))
        {
            return Err(McpError::new("INVALID_ARGUMENT", "Invalid metadata field."));
        }
    }
    let mut conn = connect(&state.paths)?;
    conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
        for (key, value) in object {
            sql_query(format!(
                "UPDATE projects SET {key}=?,updated_at=? WHERE id={id}"
            ))
            .bind::<diesel::sql_types::Nullable<Text>, _>(value.as_str())
            .bind::<Text, _>(crate::now())
            .execute(conn)?;
        }
        sql_query(format!("SELECT * FROM projects WHERE id={id}"))
            .get_result::<crate::Project>(conn)
    })
    .map_err(|_| McpError::new("NOT_FOUND", "Project not found."))
    .and_then(|p| serde_json::to_value(p).map_err(|e| e.to_string().into()))
}
