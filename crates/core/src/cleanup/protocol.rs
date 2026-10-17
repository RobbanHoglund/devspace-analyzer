use super::{prepare, Request};
use serde::Deserialize;
use serde_json::json;
use std::{io::{self, BufRead, Write}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc}, time::Duration};
fn emit(value: serde_json::Value) -> Result<(), String> {
    let mut out = io::stdout().lock(); serde_json::to_writer(&mut out, &value).map_err(|_| "Cannot write cleanup response")?;
    out.write_all(b"\n").and_then(|_| out.flush()).map_err(|_| "Cannot write cleanup response".into())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start { protocol_version: u32, request: Request }
/// Separate opt-in protocol: prepare -> plan -> {command:run,id} -> result.
pub fn serve() -> Result<(), String> {
    let mut input = io::stdin().lock(); let mut line = String::new();
    let length = std::io::Read::take(&mut input, 2 * 1024 * 1024 + 1).read_line(&mut line).map_err(|_| "Invalid cleanup input")?;
    if length > 2 * 1024 * 1024 || !line.ends_with('\n') { return Err("Cleanup input exceeds its limit.".into()); }
    let start: Start = serde_json::from_str(&line).map_err(|_| "Invalid cleanup request")?;
    if start.protocol_version != 1 { return Err("Unsupported cleanup protocol.".into()); }
    drop(input);
    let cancelled = Arc::new(AtomicBool::new(false)); let signal = cancelled.clone();
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            let mut line = String::new();
            let count = std::io::Read::take(&mut input, 4097).read_line(&mut line).unwrap_or(0);
            if count == 0 || count > 4096 || !line.ends_with('\n') { break; }
            let value = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_default();
            if value == json!({"command":"cancel"}) { break; }
            if tx.try_send(value).is_err() { break; }
        }
        signal.store(true, Ordering::Relaxed);
    });
    let prepared = prepare(start.request, &cancelled)?;
    emit(json!({"type":"plan", "data":prepared.plan}))?;
    loop {
        if cancelled.load(Ordering::Relaxed) { return Ok(()); }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(message) if message == json!({"command":"run", "id":prepared.plan.id}) => break,
            Ok(_) => return Err("Cleanup requires the current plan ID.".into()),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(_) => {},
        }
        if prepared.created.elapsed() > Duration::from_secs(300) { return Err("Cleanup preview expired. Prepare it again.".into()); }
    }
    let outcome = prepared.run(&cancelled, |text| {
        if emit(json!({"type":"log", "data":text})).is_err() { cancelled.store(true, Ordering::Relaxed); }
    })?;
    emit(json!({"type":"result", "data":outcome}))
}
