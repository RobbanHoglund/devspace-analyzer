#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod export;
mod cleanup;
use std::{path::Path, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
use devspace_core::model::{Report, ScanRequest};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    running: Arc<AtomicBool>, cancelled: Arc<AtomicBool>, report: Mutex<Option<Report>>,
    protected_paths: Mutex<Vec<String>>, cleanup: Mutex<Option<devspace_core::cleanup::Prepared>>,
}
#[tauri::command]
async fn scan(request: ScanRequest, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Report, String> {
    if state.running.swap(true, Ordering::SeqCst) { return Err("A scan is already running.".into()); }
    state.cancelled.store(false, Ordering::SeqCst);
    *state.protected_paths.lock().map_err(|_| "Protection state unavailable")? = request.protected_paths.clone();
    let cancelled = state.cancelled.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        devspace_core::scan(request, &cancelled, |progress| { let _ = app.emit("scan-progress", progress); })
    }).await;
    state.running.store(false, Ordering::SeqCst);
    let report = result.map_err(|e| format!("Scanner worker failed: {e}"))??;
    *state.report.lock().map_err(|_| "Report state unavailable")? = Some(report.clone());
    Ok(report)
}
#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) { state.cancelled.store(true, Ordering::SeqCst); }

/// Only reveal a finding from the latest native scan. Never executes a scanned file.
#[tauri::command]
fn reveal_finding(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) { return Err("Wait for the scan to finish.".into()); }
    let guard = state.report.lock().map_err(|_| "Report state unavailable")?;
    let finding = guard.as_ref().and_then(|r| r.findings.iter().find(|f| f.id == id)).ok_or("Finding is not in the current scan.")?;
    let path = Path::new(&finding.path);
    let directory = if path.is_dir() { path } else { path.parent().ok_or("No parent directory")? };
    open_directory(directory)
}

#[tauri::command]
fn reveal_storage(id: usize, state: State<'_, AppState>) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) { return Err("Wait for the scan to finish.".into()); }
    let guard = state.report.lock().map_err(|_| "Report state unavailable")?;
    let directory = guard.as_ref().and_then(|r| r.storage.directories.iter().find(|d| d.id == id)).ok_or("Folder is not in the current scan.")?;
    open_directory(Path::new(&directory.path))
}

fn open_directory(directory: &Path) -> Result<(), String> {
    let directory = devspace_core::validate_directory(directory)?;
    #[cfg(windows)]
    let result = {
        let system = std::env::var_os("SystemRoot").ok_or("SystemRoot is unavailable")?;
        // The scanner uses canonical extended-length paths. Explorer expects the
        // ordinary drive path; its long-path support is separate from file I/O.
        let text = directory.to_string_lossy();
        let shell_path = text.strip_prefix(r"\\?\").unwrap_or(&text);
        std::process::Command::new(Path::new(&system).join("explorer.exe")).arg(shell_path).spawn()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open").arg(directory).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(directory).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.running.load(Ordering::SeqCst) {
                    state.cancelled.store(true, Ordering::SeqCst);
                    if state.cleanup.lock().is_ok_and(|mut plan| plan.take().is_some()) { state.running.store(false, Ordering::SeqCst); }
                    else {
                        // Keep the host alive until its native child has stopped and been reaped.
                        api.prevent_close();
                        let running = state.running.clone(); let window = window.clone();
                        std::thread::spawn(move || {
                            while running.load(Ordering::SeqCst) { std::thread::sleep(std::time::Duration::from_millis(100)); }
                            let _ = window.close();
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![scan, cancel_scan, reveal_finding, reveal_storage, export::save_export, cleanup::save_preferences, cleanup::prepare_cleanup, cleanup::run_cleanup, cleanup::cancel_cleanup])
        .run(tauri::generate_context!())
        .expect("Unable to start DevSpace Analyzer");
}
