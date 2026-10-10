use std::{fs::OpenOptions, io::Write};
use tauri_plugin_dialog::DialogExt;

/// Explicit export is the only application-initiated filesystem write outside
/// its own preferences. A native dialog is mandatory; existing files are never overwritten.
#[tauri::command]
pub async fn save_export(content: String, extension: String, app: tauri::AppHandle) -> Result<Option<String>, String> {
    if extension != "json" && extension != "md" { return Err("Unsupported report format.".into()); }
    if content.len() > 32 * 1024 * 1024 { return Err("Report exceeds the 32 MiB export limit. Narrow the scan scope.".into()); }
    if extension == "json" { serde_json::from_str::<serde_json::Value>(&content).map_err(|_| "Invalid JSON report")?; }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_title("Export a new DevSpace report")
            .set_file_name(format!("devspace-report.{extension}"))
            .add_filter("DevSpace report", &[&extension]).blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let mut path = selected.into_path().map_err(|e| e.to_string())?;
        if path.extension().is_none() { path.set_extension(&extension); }
        if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(&extension)) {
            return Err(format!("Choose a .{extension} filename."));
        }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|e| format!("Report not saved. Choose a new filename; existing files are never overwritten. {e}"))?;
        file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| format!("Report write failed; the new report may be incomplete. {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}
