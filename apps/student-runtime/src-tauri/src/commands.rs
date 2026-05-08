use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::{bundle, pseudonyme, storage};

pub struct AppState {
    pub conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConsentRecord {
    pub consent_id: String,
    pub level_a: bool,
    pub level_b: bool,
    pub level_c: bool,
    pub granted_at: String,
    pub schema_version: String,
}

#[tauri::command]
pub fn load_bundle(zip_path: String) -> Result<String, String> {
    let path = PathBuf::from(&zip_path);
    bundle::read_lesson_json(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_consent(state: State<AppState>) -> Result<Option<ConsentRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT consent_id, level_a, level_b, level_c, granted_at, schema_version FROM consent LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([], |r| {
            Ok(ConsentRecord {
                consent_id: r.get(0)?,
                level_a: r.get::<_, i64>(1)? != 0,
                level_b: r.get::<_, i64>(2)? != 0,
                level_c: r.get::<_, i64>(3)? != 0,
                granted_at: r.get(4)?,
                schema_version: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(Ok(r)) => Ok(Some(r)),
        Some(Err(e)) => Err(e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn set_consent(
    state: State<AppState>,
    consent_id: String,
    level_a: bool,
    level_b: bool,
    level_c: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO consent (consent_id, level_a, level_b, level_c, granted_at, schema_version)
         VALUES (?, ?, ?, ?, ?, '1.0')",
        params![consent_id, level_a as i64, level_b as i64, level_c as i64, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_state(
    state: State<AppState>,
    lesson_id: String,
    state_json: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO learner_state (lesson_id, state_json, updated_at) VALUES (?, ?, ?)",
        params![lesson_id, state_json, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_state(
    state: State<AppState>,
    lesson_id: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT state_json FROM learner_state WHERE lesson_id = ?",
        params![lesson_id],
        |r| r.get::<_, String>(0),
    );
    match result {
        Ok(json) => Ok(Some(json)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventRecord {
    pub event_id: String,
    pub session_id: String,
    pub lesson_id: String,
    pub schema_version: String,
    pub event_type: String,
    pub payload_json: String,
}

#[tauri::command]
pub fn append_event(
    state: State<AppState>,
    event_id: String,
    session_id: String,
    lesson_id: String,
    schema_version: String,
    event_type: String,
    payload_json: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let pseudo_bytes = storage::load_student_secret(&conn).map_err(|e| e.to_string())?;
    let pseudo = pseudonyme::compute_pseudonyme(&pseudo_bytes, &lesson_id);
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO events (event_id, session_id, pseudonyme, lesson_id, schema_version, timestamp, event_type, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![event_id, session_id, pseudo, lesson_id, schema_version, now, event_type, payload_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_pseudonyme(state: State<AppState>, lesson_id: String) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let secret = storage::load_student_secret(&conn).map_err(|e| e.to_string())?;
    Ok(pseudonyme::compute_pseudonyme(&secret, &lesson_id))
}

#[tauri::command]
pub fn delete_all_data(state: State<AppState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    storage::delete_all(&conn).map_err(|e| e.to_string())
}
