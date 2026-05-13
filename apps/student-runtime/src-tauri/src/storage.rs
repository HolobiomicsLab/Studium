use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use crate::keystore;
use crate::pseudonyme;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct JournalEntry {
    pub id: i64,
    pub scene_id: String,
    pub content_encrypted: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision_index: i64,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("keystore error: {0}")]
    Keystore(#[from] keystore::KeystoreError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub fn db_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("studium.sqlite")
}

pub fn open_or_init(app_data_dir: &PathBuf) -> Result<Connection, StorageError> {
    let key = match keystore::load_db_key()? {
        Some(k) => k,
        None => {
            let k = pseudonyme::generate_secret();
            keystore::store_db_key(&k)?;
            k
        }
    };
    open_or_init_with_key(app_data_dir, &key)
}

pub fn open_or_init_with_key(app_data_dir: &PathBuf, key: &[u8; 32]) -> Result<Connection, StorageError> {
    std::fs::create_dir_all(app_data_dir)?;
    let conn = Connection::open(db_path(app_data_dir))?;
    let key_hex = hex::encode(key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", key_hex))?;
    apply_schema(&conn)?;
    ensure_student_secret(&conn)?;
    Ok(conn)
}

fn apply_schema(conn: &Connection) -> Result<(), StorageError> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS consent (
            consent_id     TEXT PRIMARY KEY,
            level_a        INTEGER NOT NULL,
            level_b        INTEGER NOT NULL,
            level_c        INTEGER NOT NULL,
            granted_at     TEXT NOT NULL,
            schema_version TEXT NOT NULL DEFAULT '1.0'
        );
        CREATE TABLE IF NOT EXISTS student_secret (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            secret_bytes BLOB NOT NULL,
            created_at   TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS learner_state (
            lesson_id  TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            event_id       TEXT PRIMARY KEY,
            session_id     TEXT NOT NULL,
            pseudonyme     TEXT NOT NULL,
            lesson_id      TEXT NOT NULL,
            schema_version TEXT NOT NULL,
            timestamp      TEXT NOT NULL,
            event_type     TEXT NOT NULL,
            payload_json   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_lesson    ON events(lesson_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE TABLE IF NOT EXISTS telemetry_outbox (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event_json  TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_created
            ON telemetry_outbox(created_at);
        CREATE TABLE IF NOT EXISTS learner_journal (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id          TEXT NOT NULL,
            content_encrypted TEXT NOT NULL,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL,
            revision_index    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_journal_scene ON learner_journal(scene_id);
    ")?;
    Ok(())
}

pub fn journal_create(
    conn: &Connection,
    scene_id: &str,
    content_encrypted: &str,
) -> Result<i64, StorageError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO learner_journal
         (scene_id, content_encrypted, created_at, updated_at, revision_index)
         VALUES (?, ?, ?, ?, 0)",
        params![scene_id, content_encrypted, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn journal_update(
    conn: &Connection,
    entry_id: i64,
    content_encrypted: &str,
) -> Result<(), StorageError> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE learner_journal
         SET content_encrypted = ?,
             updated_at        = ?,
             revision_index    = revision_index + 1
         WHERE id = ?",
        params![content_encrypted, now, entry_id],
    )?;
    if affected == 0 {
        return Err(StorageError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
    }
    Ok(())
}

pub fn journal_list(
    conn: &Connection,
    scene_id: Option<&str>,
) -> Result<Vec<JournalEntry>, StorageError> {
    let mut entries = Vec::new();
    match scene_id {
        Some(sid) => {
            let mut stmt = conn.prepare(
                "SELECT id, scene_id, content_encrypted, created_at, updated_at, revision_index
                 FROM learner_journal
                 WHERE scene_id = ?
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map(params![sid], |r| {
                Ok(JournalEntry {
                    id: r.get(0)?,
                    scene_id: r.get(1)?,
                    content_encrypted: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    revision_index: r.get(5)?,
                })
            })?;
            for row in rows {
                entries.push(row?);
            }
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, scene_id, content_encrypted, created_at, updated_at, revision_index
                 FROM learner_journal
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(JournalEntry {
                    id: r.get(0)?,
                    scene_id: r.get(1)?,
                    content_encrypted: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    revision_index: r.get(5)?,
                })
            })?;
            for row in rows {
                entries.push(row?);
            }
        }
    }
    Ok(entries)
}

pub fn telemetry_outbox_push(conn: &Connection, event_json: &str) -> Result<(), StorageError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO telemetry_outbox (event_json, created_at) VALUES (?, ?)",
        params![event_json, now],
    )?;
    Ok(())
}

pub fn telemetry_outbox_drain(conn: &Connection) -> Result<Vec<String>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, event_json FROM telemetry_outbox ORDER BY id ASC",
    )?;
    let mut ids: Vec<i64> = Vec::new();
    let mut events: Vec<String> = Vec::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, json) = row?;
        ids.push(id);
        events.push(json);
    }
    if !ids.is_empty() {
        let placeholders: Vec<String> = (0..ids.len()).map(|_| "?".to_string()).collect();
        let sql = format!(
            "DELETE FROM telemetry_outbox WHERE id IN ({})",
            placeholders.join(",")
        );
        let id_params: Vec<&dyn rusqlite::ToSql> = ids.iter()
            .map(|i| i as &dyn rusqlite::ToSql)
            .collect();
        conn.execute(&sql, id_params.as_slice())?;
    }
    Ok(events)
}

pub fn telemetry_outbox_count(conn: &Connection) -> Result<i64, StorageError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM telemetry_outbox", [], |r| r.get(0))?;
    Ok(count)
}

fn ensure_student_secret(conn: &Connection) -> Result<(), StorageError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM student_secret", [], |r| r.get(0))?;
    if count == 0 {
        let secret = pseudonyme::generate_secret();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO student_secret (id, secret_bytes, created_at) VALUES (1, ?, ?)",
            params![&secret[..], now],
        )?;
    }
    Ok(())
}

pub fn load_student_secret(conn: &Connection) -> Result<[u8; 32], StorageError> {
    let bytes: Vec<u8> = conn.query_row(
        "SELECT secret_bytes FROM student_secret WHERE id = 1", [], |r| r.get(0))?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes[..32]);
    Ok(key)
}

pub fn delete_all(conn: &Connection) -> Result<(), StorageError> {
    conn.execute_batch("
        DELETE FROM events;
        DELETE FROM learner_state;
        DELETE FROM consent;
        DELETE FROM telemetry_outbox;
        DELETE FROM learner_journal;
    ")?;
    let new_secret = pseudonyme::generate_secret();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE student_secret SET secret_bytes = ?, created_at = ? WHERE id = 1",
        params![&new_secret[..], now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    const TEST_KEY: [u8; 32] = [42u8; 32];

    fn temp_dir() -> PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let mut p = env::temp_dir();
        p.push(format!("studium-test-{}-{}", std::process::id(), id));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn open_creates_tables_and_secret() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM student_secret", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn delete_all_truncates_and_resets_secret() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let secret_before = load_student_secret(&conn).unwrap();
        delete_all(&conn).expect("delete");
        let secret_after = load_student_secret(&conn).unwrap();
        assert_ne!(secret_before, secret_after);
    }

    #[test]
    fn append_and_load_state() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("INSERT INTO learner_state VALUES (?, ?, ?)",
            params!["L1", "{\"lesson_id\":\"L1\"}", now]).unwrap();
        let json: String = conn.query_row(
            "SELECT state_json FROM learner_state WHERE lesson_id = ?", ["L1"], |r| r.get(0))
            .unwrap();
        assert!(json.contains("L1"));
    }

    #[test]
    fn telemetry_outbox_round_trip() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        assert_eq!(telemetry_outbox_count(&conn).unwrap(), 0);
        telemetry_outbox_push(&conn, "{\"type\":\"scene_entered\",\"scene_id\":\"s1\"}").unwrap();
        telemetry_outbox_push(&conn, "{\"type\":\"scene_entered\",\"scene_id\":\"s2\"}").unwrap();
        assert_eq!(telemetry_outbox_count(&conn).unwrap(), 2);
        let drained = telemetry_outbox_drain(&conn).unwrap();
        assert_eq!(drained.len(), 2);
        assert!(drained[0].contains("s1"));
        assert!(drained[1].contains("s2"));
        assert_eq!(telemetry_outbox_count(&conn).unwrap(), 0);
    }

    #[test]
    fn telemetry_outbox_drain_empty() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let drained = telemetry_outbox_drain(&conn).unwrap();
        assert_eq!(drained.len(), 0);
    }

    #[test]
    fn telemetry_outbox_wiped_by_delete_all() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        telemetry_outbox_push(&conn, "{\"type\":\"x\"}").unwrap();
        delete_all(&conn).unwrap();
        assert_eq!(telemetry_outbox_count(&conn).unwrap(), 0);
    }

    #[test]
    fn test_journal_table_created() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='learner_journal'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "learner_journal table should exist");
    }

    #[test]
    fn test_journal_create_and_list() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let id = journal_create(&conn, "scene-A", "encrypted-content-1").expect("create");
        assert!(id > 0);

        let entries = journal_list(&conn, Some("scene-A")).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].scene_id, "scene-A");
        assert_eq!(entries[0].content_encrypted, "encrypted-content-1");
        assert_eq!(entries[0].revision_index, 0);

        // Non-matching scene_id returns nothing
        let other = journal_list(&conn, Some("scene-B")).expect("list");
        assert_eq!(other.len(), 0);

        // None returns all
        let all = journal_list(&conn, None).expect("list-all");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_journal_update_increments_revision() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        let id = journal_create(&conn, "scene-X", "v0").expect("create");

        journal_update(&conn, id, "v1").expect("update");
        let entries = journal_list(&conn, Some("scene-X")).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content_encrypted, "v1");
        assert_eq!(entries[0].revision_index, 1);

        journal_update(&conn, id, "v2").expect("update");
        let entries = journal_list(&conn, Some("scene-X")).expect("list");
        assert_eq!(entries[0].content_encrypted, "v2");
        assert_eq!(entries[0].revision_index, 2);

        // Updating a non-existent id is an error
        let err = journal_update(&conn, 99_999, "nope");
        assert!(err.is_err(), "updating missing entry should fail");
    }

    #[test]
    fn test_journal_wiped_by_delete_all_data() {
        let dir = temp_dir();
        let conn = open_or_init_with_key(&dir, &TEST_KEY).expect("open");
        journal_create(&conn, "scene-Z", "secret").expect("create");
        assert_eq!(journal_list(&conn, None).unwrap().len(), 1);
        delete_all(&conn).expect("wipe");
        assert_eq!(
            journal_list(&conn, None).unwrap().len(),
            0,
            "journal should be wiped by delete_all"
        );
    }
}
