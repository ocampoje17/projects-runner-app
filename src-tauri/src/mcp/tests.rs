use super::{notes, policy, store, types::*};
use crate::{connect, init_db, AppPaths};
use diesel::{connection::SimpleConnection, prelude::*, sql_query};
use serde_json::json;

#[path = "command_tests.rs"]
mod command_security;

struct Fixture(AppPaths);
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "projects-runner-mcp-tests-{}",
            uuid::Uuid::new_v4()
        ));
        let paths = AppPaths {
            db_path: dir.join("test.sqlite"),
            avatars_dir: dir.join("avatars"),
            scripts_dir: dir.join("scripts"),
        };
        init_db(&paths).unwrap();
        connect(&paths).unwrap().batch_execute("INSERT INTO projects(id,name,path,created_at,updated_at) VALUES(1,'One','/one','created','updated'),(2,'Two','/two','created','updated');").unwrap();
        Self(paths)
    }
    fn update(&self, c: &McpClient, permissions: &[&str], scope: &str) -> McpClientUpdate {
        McpClientUpdate {
            name: c.name.clone(),
            enabled: c.enabled,
            project_scope: scope.into(),
            permissions: permissions.iter().map(|p| p.to_string()).collect(),
            project_ids: vec![1],
            account_ids: vec![],
            expected_policy_revision: c.policy_revision,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.db_path.parent().unwrap());
    }
}

#[test]
fn notes_can_clear_content_while_preserving_title() {
    let f = Fixture::new();
    let note = notes::mutate(&f.0, 1, "create", json!({"title":"A","content":"body"})).unwrap();
    let saved = notes::mutate(
        &f.0,
        1,
        "update",
        json!({"note_id":note["id"],"expected_version":note["version"],"content":""}),
    ).unwrap();
    let loaded = notes::load(&mut connect(&f.0).unwrap(), 1).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0]["title"], "A");
    assert_eq!(loaded[0]["content"], "");
    assert_eq!(saved["version"], notes::version(&loaded[0]));

    for patch in [json!({"title":" "}), json!({"content":null})] {
        let mut input = patch;
        input["note_id"] = saved["id"].clone();
        input["expected_version"] = saved["version"].clone();
        assert_eq!(notes::mutate(&f.0, 1, "update", input).unwrap_err().code, "INVALID_ARGUMENT");
    }
}

#[test]
fn defaults_migration_and_one_time_token() {
    let f = Fixture::new();
    assert!(!store::settings(&f.0).unwrap().enabled);
    assert_eq!(store::settings(&f.0).unwrap().port, 6811);
    store::init(&mut connect(&f.0).unwrap()).unwrap();
    let t = store::create(&f.0, "AI".into()).unwrap();
    assert_eq!(t.token.len(), 43);
    assert!(
        t.client.permissions.is_empty()
            && t.client.project_ids.is_empty()
            && t.client.account_ids.is_empty()
    );
    assert_eq!(t.client.project_scope, "selected");
    let mut conn = connect(&f.0).unwrap();
    let persisted = store::rows(
        &mut conn,
        "SELECT json_object('client',json(value),'hash',token_hash) value FROM mcp_clients",
    )
    .unwrap();
    assert!(!persisted[0].to_string().contains(&t.token));
    assert_eq!(persisted[0]["hash"], store::hash(&t.token));
}

#[test]
fn authentication_rotation_disable_and_delete_are_immediate() {
    let f = Fixture::new();
    let t = store::create(&f.0, "AI".into()).unwrap();
    assert!(store::authenticate(&f.0, "").is_err());
    assert!(store::authenticate(&f.0, "wrong").is_err());
    assert_eq!(store::authenticate(&f.0, &t.token).unwrap().id, t.client.id);
    let rotated = store::rotate(&f.0, &t.client.id).unwrap();
    assert!(store::authenticate(&f.0, &t.token).is_err());
    assert!(policy::refresh(&f.0, &t.client).is_err());
    let mut u = f.update(&rotated.client, &[], "selected");
    u.enabled = false;
    store::update(&f.0, &t.client.id, u).unwrap();
    assert!(store::authenticate(&f.0, &rotated.token).is_err());
    store::remove(&f.0, &t.client.id).unwrap();
    assert!(store::client(&f.0, &t.client.id).is_err());
}

#[test]
fn policy_revision_and_independent_permissions() {
    let f = Fixture::new();
    let t = store::create(&f.0, "AI".into()).unwrap();
    let u = f.update(
        &t.client,
        &["projects.read", "commands.execute", "sync.run"],
        "all",
    );
    let c = store::update(&f.0, &t.client.id, u.clone()).unwrap();
    assert_eq!(store::update(&f.0, &c.id, u).unwrap_err().code, "CONFLICT");
    assert!(policy::permission(&c, "notes.read").is_err());
    assert!(policy::permission(&c, "commands.output.read").is_err());
    assert!(policy::project(&c, 2).is_ok());
    let c = store::update(
        &f.0,
        &c.id,
        f.update(&c, &["sync.run", "twofa.accounts.read"], "selected"),
    )
    .unwrap();
    assert!(policy::permission(&c, "sync.run").is_err());
    assert!(policy::permission(&c, "twofa.codes.read").is_err());
    assert_eq!(policy::project(&c, 2).unwrap_err().code, "NOT_FOUND");
    assert!(policy::account(&c, "").is_err());
}

#[test]
fn invalid_scope_update_rolls_back_and_deleted_projects_leave_no_grants() {
    let f = Fixture::new();
    let t = store::create(&f.0, "AI".into()).unwrap();
    let c = store::update(
        &f.0,
        &t.client.id,
        f.update(&t.client, &["projects.read"], "selected"),
    )
    .unwrap();
    let mut u = f.update(&c, &["projects.delete"], "selected");
    u.project_ids = vec![999];
    assert!(store::update(&f.0, &c.id, u).is_err());
    assert_eq!(
        store::client(&f.0, &c.id).unwrap().permissions,
        vec!["projects.read"]
    );
    sql_query("DELETE FROM projects WHERE id=1")
        .execute(&mut connect(&f.0).unwrap())
        .unwrap();
    assert!(store::client(&f.0, &c.id).unwrap().project_ids.is_empty());
}

#[test]
fn notes_concurrent_edits_preserve_unrelated_notes_and_metadata() {
    let f = Fixture::new();
    let a = notes::mutate(&f.0, 1, "create", json!({"title":"A","content":"a"})).unwrap();
    let b = notes::mutate(&f.0, 1, "create", json!({"title":"B","content":"b"})).unwrap();
    let mut handles = vec![];
    for n in [a, b] {
        let paths = f.0.clone();
        handles.push(std::thread::spawn(move || {
            notes::mutate(
                &paths,
                1,
                "update",
                json!({"note_id":n["id"],"expected_version":n["version"],"content":"edited"}),
            )
            .unwrap()
        }));
    }
    for handle in handles {
        handle.join().unwrap();
    }
    let notes = notes::load(&mut connect(&f.0).unwrap(), 1).unwrap();
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().all(|n| n["content"] == "edited"));
    let metadata = store::rows(
        &mut connect(&f.0).unwrap(),
        "SELECT json_object('name',name,'path',path) value FROM projects WHERE id=1",
    )
    .unwrap();
    assert_eq!(metadata[0], json!({"name":"One","path":"/one"}));
}

#[test]
fn stale_note_edits_and_deletes_fail_without_changing_current_data() {
    let f = Fixture::new();
    let n = notes::mutate(&f.0, 1, "create", json!({"title":"A","content":"body"})).unwrap();
    let input = json!({"note_id":n["id"],"expected_version":n["version"],"content":"latest"});
    notes::mutate(&f.0, 1, "update", input.clone()).unwrap();
    assert_eq!(
        notes::mutate(&f.0, 1, "update", input.clone())
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(
        notes::mutate(&f.0, 1, "delete", input).unwrap_err().code,
        "CONFLICT"
    );
    assert_eq!(
        notes::load(&mut connect(&f.0).unwrap(), 1).unwrap()[0]["content"],
        "latest"
    );
}

#[test]
fn legacy_notes_have_stable_identity_and_versions() {
    let f = Fixture::new();
    sql_query("UPDATE projects SET notes='# Legacy note' WHERE id=1")
        .execute(&mut connect(&f.0).unwrap())
        .unwrap();
    let a = notes::load(&mut connect(&f.0).unwrap(), 1).unwrap();
    let b = notes::load(&mut connect(&f.0).unwrap(), 1).unwrap();
    assert_eq!(a, b);
    assert_eq!(a[0]["title"], "Legacy note");
    let mut n = a[0].clone();
    n["version"] = json!("ignored");
    assert_eq!(notes::version(&a[0]), notes::version(&n));
}

#[test]
fn activity_is_bounded_and_survives_client_deletion() {
    let f = Fixture::new();
    let t = store::create(&f.0, "AI".into()).unwrap();
    for _ in 0..1005 {
        store::activity(
            &f.0,
            &t.client,
            "twofa_get_code",
            Some("account".into()),
            None,
            1,
        );
    }
    store::remove(&f.0, &t.client.id).unwrap();
    let mut count = 0;
    for offset in (0..1100).step_by(50) {
        let p = store::activities(&f.0, None, None, offset).unwrap();
        for a in &p.items {
            assert_eq!(a.client_name, "AI");
        }
        count += p.items.len();
    }
    assert_eq!(count, 1000);
    let raw = store::rows(
        &mut connect(&f.0).unwrap(),
        "SELECT value FROM mcp_activity LIMIT 1",
    )
    .unwrap();
    assert!(
        raw[0].get("token").is_none()
            && raw[0].get("code").is_none()
            && raw[0].get("response").is_none()
    );
}
