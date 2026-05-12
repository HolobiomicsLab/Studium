pub mod pseudonyme;
pub mod keystore;
pub mod storage;
pub mod bundle;
pub mod commands;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("studium");
    let conn = storage::open_or_init(&app_data_dir).expect("storage init");
    let state = commands::AppState { conn: Mutex::new(conn) };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::load_bundle,
            commands::get_consent,
            commands::set_consent,
            commands::save_state,
            commands::load_state,
            commands::append_event,
            commands::get_pseudonyme,
            commands::delete_all_data,
            commands::telemetry_outbox_push,
            commands::telemetry_outbox_drain,
            commands::telemetry_outbox_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
