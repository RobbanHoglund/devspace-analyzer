use super::AppState;
use devspace_core::cleanup::{self, Action, Outcome, Plan};
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};

#[tauri::command]
pub fn save_preferences(protected_paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    if protected_paths.len() > 20_000 || protected_paths.iter().any(|p| p.len() > 32768 || !std::path::Path::new(p).is_absolute()) { return Err("Invalid protection preferences.".into()); }
    let mut current = state.protected_paths.lock().map_err(|_| "Protection state unavailable")?;
    if *current == protected_paths { return Ok(()); }
    if state.running.load(Ordering::SeqCst) { return Err("Finish the current operation before changing protection.".into()); }
    *current = protected_paths; Ok(())
}
#[tauri::command]
pub async fn prepare_cleanup(id: String, action: Action, expected_path: String, state: State<'_, AppState>) -> Result<Plan, String> {
    if state.running.swap(true, Ordering::SeqCst) { return Err("Finish the current scan or cleanup first.".into()); }
    state.cancelled.store(false, Ordering::SeqCst);
    let request = (|| {
        let report = state.report.lock().map_err(|_| "Report state unavailable")?;
        let protected = state.protected_paths.lock().map_err(|_| "Protection state unavailable")?.clone();
        let report = report.as_ref().ok_or("Scan before preparing cleanup.")?;
        if report.findings.iter().find(|f| f.id == id).is_none_or(|f| f.path != expected_path) { return Err("This finding changed. Scan again before cleanup.".into()); }
        cleanup::request(report, &id, action, protected)
    })();
    let request = match request { Ok(r) => r, Err(e) => { state.running.store(false, Ordering::SeqCst); return Err(e); } };
    let cancelled = state.cancelled.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || cleanup::prepare(request, &cancelled)).await.map_err(|e| e.to_string()).and_then(|r| r);
    match prepared {
        Ok(value) => {
            let mut guard = state.cleanup.lock().map_err(|_| "Cleanup state unavailable")?;
            if state.cancelled.load(Ordering::SeqCst) { state.running.store(false, Ordering::SeqCst); return Err("Cleanup cancelled.".into()); }
            let plan = value.plan.clone();
            *guard = Some(value);
            Ok(plan)
        },
        Err(error) => { state.running.store(false, Ordering::SeqCst); Err(error) },
    }
}
#[tauri::command]
pub async fn run_cleanup(id: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Outcome, String> {
    let prepared = {
        let mut guard = state.cleanup.lock().map_err(|_| "Cleanup state unavailable")?;
        if !guard.as_ref().is_some_and(|p| p.plan.id == id) { return Err("Prepare and review the current cleanup plan first.".into()); }
        guard.take().unwrap()
    };
    let cancelled = state.cancelled.clone();
    let result = tauri::async_runtime::spawn_blocking(move || prepared.run(&cancelled, |text| { let _ = app.emit("cleanup-log", text); })).await.map_err(|e| e.to_string()).and_then(|r| r);
    // Any attempted execution makes the old report stale; a fresh scan is required.
    *state.report.lock().map_err(|_| "Report state unavailable")? = None;
    state.running.store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub fn cancel_cleanup(state: State<'_, AppState>) {
    state.cancelled.store(true, Ordering::SeqCst);
    if state.cleanup.lock().is_ok_and(|mut plan| plan.take().is_some()) { state.running.store(false, Ordering::SeqCst); }
}
