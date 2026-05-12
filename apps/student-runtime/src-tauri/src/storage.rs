use rusqlite::{params, Connection};
use std::path::PathBuf;
use thiserror::Error;
use crate::keystore;
use crate::pseudonyme;

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
    ")?;
    Ok(())
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
}
