use super::types::*;
use crate::{connect, AppPaths};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use diesel::{
    connection::SimpleConnection,
    prelude::*,
    sql_query,
    sql_types::{Integer, Text},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Text)]
    value: String,
}
pub fn rows(conn: &mut SqliteConnection, sql: &str) -> std::result::Result<Vec<Value>, String> {
    sql_query(sql)
        .load::<Row>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| serde_json::from_str(&r.value).map_err(|e| e.to_string()))
        .collect()
}
pub fn init(conn: &mut SqliteConnection) -> std::result::Result<(), String> {
    conn.immediate_transaction::<_,diesel::result::Error,_>(|conn|conn.batch_execute("CREATE TABLE IF NOT EXISTS mcp_settings(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, enabled INTEGER NOT NULL, port INTEGER NOT NULL);
    INSERT OR IGNORE INTO mcp_settings VALUES(1,1,0,6811);
    CREATE TABLE IF NOT EXISTS mcp_clients(id TEXT PRIMARY KEY, value TEXT NOT NULL, token_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_client_permissions(client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE, permission TEXT NOT NULL, PRIMARY KEY(client_id,permission));
    CREATE TABLE IF NOT EXISTS mcp_client_projects(client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(client_id,project_id));
    CREATE TABLE IF NOT EXISTS mcp_client_twofa_accounts(client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES twofa_accounts(id) ON DELETE CASCADE, PRIMARY KEY(client_id,account_id));
    CREATE TABLE IF NOT EXISTS mcp_activity(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);"))
        .map_err(|e| e.to_string())
}
pub fn settings(paths: &AppPaths) -> std::result::Result<McpSettings, String> {
    let v = rows(&mut connect(paths)?, "SELECT json_object('enabled',json(CASE enabled WHEN 1 THEN 'true' ELSE 'false' END),'port',port) value FROM mcp_settings WHERE id=1")?;
    serde_json::from_value(v[0].clone()).map_err(|e| e.to_string())
}
pub fn save_settings(paths: &AppPaths, s: &McpSettings) -> std::result::Result<(), String> {
    sql_query("UPDATE mcp_settings SET enabled=?,port=? WHERE id=1")
        .bind::<Integer, _>(s.enabled as i32)
        .bind::<Integer, _>(s.port as i32)
        .execute(&mut connect(paths)?)
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn clients(paths: &AppPaths) -> std::result::Result<Vec<McpClient>, String> {
    let mut conn = connect(paths)?;
    let mut all = rows(
        &mut conn,
        "SELECT value FROM mcp_clients ORDER BY json_extract(value,'$.created_at')",
    )?
    .into_iter()
    .map(serde_json::from_value::<McpClient>)
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    for c in &mut all {
        c.project_ids = sql_query(
            "SELECT CAST(project_id AS TEXT) value FROM mcp_client_projects WHERE client_id=?",
        )
        .bind::<Text, _>(&c.id)
        .load::<Row>(&mut conn)
        .map_err(|e| e.to_string())?
        .iter()
        .filter_map(|r| r.value.parse().ok())
        .collect();
        c.account_ids =
            sql_query("SELECT account_id value FROM mcp_client_twofa_accounts WHERE client_id=?")
                .bind::<Text, _>(&c.id)
                .load::<Row>(&mut conn)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| r.value)
                .collect();
    }
    Ok(all)
}
pub fn client(paths: &AppPaths, id: &str) -> Result<McpClient> {
    clients(paths)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| McpError::new("NOT_FOUND", "Client not found."))
}
pub fn hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
fn token() -> String {
    URL_SAFE_NO_PAD.encode(crate::twofa::generate_random_bytes::<32>())
}
pub fn authenticate(paths: &AppPaths, token: &str) -> Result<McpClient> {
    let hash = hash(token);
    let mut conn = connect(paths)?;
    let values = rows(
        &mut conn,
        "SELECT json_object('id',id,'hash',token_hash) value FROM mcp_clients",
    )?;
    let id = values
        .iter()
        .find(|v| {
            v["hash"]
                .as_str()
                .is_some_and(|h| bool::from(h.as_bytes().ct_eq(hash.as_bytes())))
        })
        .and_then(|v| v["id"].as_str())
        .ok_or_else(|| McpError::new("UNAUTHORIZED", "Invalid client token."))?;
    let c = client(paths, id)?;
    if !c.enabled {
        return Err(McpError::new("UNAUTHORIZED", "Client is disabled."));
    }
    Ok(c)
}
pub fn create(paths: &AppPaths, name: String) -> Result<McpClientToken> {
    if name.trim().is_empty() || name.len() > 100 {
        return Err(McpError::new(
            "INVALID_ARGUMENT",
            "Client name is required (maximum 100 characters).",
        ));
    }
    let t = token();
    let now = crate::now();
    let c = McpClient {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().into(),
        enabled: true,
        token_prefix: t[..8].into(),
        project_scope: "selected".into(),
        permissions: vec![],
        project_ids: vec![],
        account_ids: vec![],
        policy_revision: 1,
        created_at: now.clone(),
        updated_at: now,
        last_used_at: None,
    };
    sql_query("INSERT INTO mcp_clients(id,value,token_hash) VALUES(?,?,?)")
        .bind::<Text, _>(&c.id)
        .bind::<Text, _>(serde_json::to_string(&c).unwrap())
        .bind::<Text, _>(hash(&t))
        .execute(&mut connect(paths)?)
        .map_err(|e| e.to_string())?;
    Ok(McpClientToken {
        client: c,
        token: t,
    })
}
pub fn update(paths: &AppPaths, id: &str, u: McpClientUpdate) -> Result<McpClient> {
    if u.name.trim().is_empty()
        || u.name.len() > 100
        || !["all", "selected"].contains(&u.project_scope.as_str())
        || u.permissions
            .iter()
            .any(|p| !PERMISSIONS.contains(&p.as_str()))
    {
        return Err(McpError::new("INVALID_ARGUMENT", "Invalid client policy."));
    }
    let mut conn = connect(paths)?;
    conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
        let raw = sql_query("SELECT value FROM mcp_clients WHERE id=?")
            .bind::<Text, _>(id)
            .get_result::<Row>(conn)?;
        let mut c: McpClient = serde_json::from_str(&raw.value).unwrap();
        if c.policy_revision != u.expected_policy_revision {
            return Err(diesel::result::Error::RollbackTransaction);
        }
        c.name = u.name.trim().into();
        c.enabled = u.enabled;
        c.project_scope = u.project_scope;
        c.permissions = u.permissions;
        if c.project_scope != "all" {
            c.permissions.retain(|p| p != "sync.run");
        }
        c.permissions.sort();
        c.permissions.dedup();
        c.project_ids = u.project_ids;
        c.project_ids.sort();
        c.project_ids.dedup();
        c.account_ids = u.account_ids;
        c.account_ids.sort();
        c.account_ids.dedup();
        c.policy_revision += 1;
        c.updated_at = crate::now();
        for table in [
            "mcp_client_permissions",
            "mcp_client_projects",
            "mcp_client_twofa_accounts",
        ] {
            sql_query(format!("DELETE FROM {table} WHERE client_id=?"))
                .bind::<Text, _>(id)
                .execute(conn)?;
        }
        for p in &c.permissions {
            sql_query("INSERT INTO mcp_client_permissions VALUES(?,?)")
                .bind::<Text, _>(id)
                .bind::<Text, _>(p)
                .execute(conn)?;
        }
        for p in &c.project_ids {
            sql_query("INSERT INTO mcp_client_projects VALUES(?,?)")
                .bind::<Text, _>(id)
                .bind::<Integer, _>(*p)
                .execute(conn)?;
        }
        for a in &c.account_ids {
            sql_query("INSERT INTO mcp_client_twofa_accounts VALUES(?,?)")
                .bind::<Text, _>(id)
                .bind::<Text, _>(a)
                .execute(conn)?;
        }
        sql_query("UPDATE mcp_clients SET value=? WHERE id=?")
            .bind::<Text, _>(serde_json::to_string(&c).unwrap())
            .bind::<Text, _>(id)
            .execute(conn)?;
        Ok(c)
    })
    .map_err(|e| {
        if matches!(e, diesel::result::Error::RollbackTransaction) {
            McpError::new("CONFLICT", "Client policy changed. Reload and try again.")
        } else {
            McpError::new(
                "INVALID_ARGUMENT",
                "Unable to save policy. Reload the available projects and accounts.",
            )
        }
    })
}
pub fn rotate(paths: &AppPaths, id: &str) -> Result<McpClientToken> {
    let t = token();
    let mut conn = connect(paths)?;
    conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
        let raw = sql_query("SELECT value FROM mcp_clients WHERE id=?")
            .bind::<Text, _>(id)
            .get_result::<Row>(conn)?;
        let mut c: McpClient = serde_json::from_str(&raw.value)
            .map_err(|_| diesel::result::Error::RollbackTransaction)?;
        c.token_prefix = t[..8].into();
        c.policy_revision += 1;
        c.updated_at = crate::now();
        sql_query("UPDATE mcp_clients SET value=?,token_hash=? WHERE id=?")
            .bind::<Text, _>(serde_json::to_string(&c).unwrap())
            .bind::<Text, _>(hash(&t))
            .bind::<Text, _>(id)
            .execute(conn)?;
        Ok(())
    })
    .map_err(|_| McpError::new("NOT_FOUND", "Client not found."))?;
    let c = client(paths, id)?;
    Ok(McpClientToken {
        client: c,
        token: t,
    })
}
pub fn remove(paths: &AppPaths, id: &str) -> Result<()> {
    sql_query("DELETE FROM mcp_clients WHERE id=?")
        .bind::<Text, _>(id)
        .execute(&mut connect(paths)?)
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn activity(
    paths: &AppPaths,
    c: &McpClient,
    tool: &str,
    target: Option<String>,
    error: Option<&str>,
    ms: i32,
) {
    if let Ok(mut conn) = connect(paths) {
        let value = json!({"client_id":c.id,"client_name":c.name,"tool":tool,"target_id":target,"created_at":crate::now(),"success":error.is_none(),"error_code":error,"duration_ms":ms});
        let _ = sql_query("INSERT INTO mcp_activity(value) VALUES(?)")
            .bind::<Text, _>(value.to_string())
            .execute(&mut conn);
        let _=sql_query("DELETE FROM mcp_activity WHERE id NOT IN (SELECT id FROM mcp_activity ORDER BY id DESC LIMIT 1000)").execute(&mut conn);
        let _ =
            sql_query("UPDATE mcp_clients SET value=json_set(value,'$.last_used_at',?) WHERE id=?")
                .bind::<Text, _>(crate::now())
                .bind::<Text, _>(&c.id)
                .execute(&mut conn);
    }
}
pub fn activities(
    paths: &AppPaths,
    client_id: Option<String>,
    success: Option<bool>,
    offset: u32,
) -> Result<McpActivityPage> {
    let mut items = rows(
        &mut connect(paths)?,
        "SELECT json_set(value,'$.id',id) value FROM mcp_activity ORDER BY id DESC",
    )?
    .into_iter()
    .map(serde_json::from_value::<McpActivity>)
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    items.retain(|i| {
        client_id.as_ref().is_none_or(|id| id == &i.client_id)
            && success.is_none_or(|s| s == i.success)
    });
    let mut items: Vec<_> = items.into_iter().skip(offset as usize).take(51).collect();
    let has_more = items.len() > 50;
    items.truncate(50);
    Ok(McpActivityPage { items, has_more })
}
