//! One read-only scan per process. Newline-delimited JSON over stdio, protocol v1.
//! stdin stays open for cancellation; closing it also cancels the scan.
use devspace_core::model::ScanRequest;
use serde::Deserialize;
use serde_json::json;
use std::io::{self, BufRead, Write};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};

const MAX_INPUT: u64 = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start { protocol_version: u32, request: ExplicitRequest }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplicitRequest { roots: Vec<String>, include_global_caches: bool, protected_paths: Vec<String> }

fn emit(value: serde_json::Value) -> io::Result<()> {
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, &value)?;
    out.write_all(b"\n")?;
    out.flush()
}

fn run() -> Result<(), String> {
    let mut input = io::stdin().lock();
    let mut line = String::new();
    // Bound allocation before deserializing untrusted request input.
    let length = std::io::Read::take(&mut input, MAX_INPUT + 1)
        .read_line(&mut line).map_err(|_| "Could not read scan request")?;
    if length == 0 || length as u64 > MAX_INPUT || !line.ends_with('\n') {
        return Err("Expected one JSON request line, at most 2 MiB.".into());
    }
    let start: Start = serde_json::from_str(&line).map_err(|_| "Invalid scan request")?;
    if start.protocol_version != 1 { return Err("Unsupported scanner protocol version.".into()); }
    drop(input);
    let request = ScanRequest { roots: start.request.roots, include_global_caches: start.request.include_global_caches, protected_paths: start.request.protected_paths };

    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            let mut line = String::new();
            let result = std::io::Read::take(&mut input, 1025).read_line(&mut line);
            match result {
                Ok(n) if n > 0 && n <= 1024 && line.ends_with('\n') => {
                    if serde_json::from_str::<serde_json::Value>(&line).ok()
                        .is_some_and(|v| v == json!({"command":"cancel"})) {
                        signal.store(true, Ordering::Relaxed);
                        return;
                    }
                }
                _ => { signal.store(true, Ordering::Relaxed); return; }
            }
        }
    });
    let report = devspace_core::scan(request, &cancelled, |progress| {
        if emit(json!({"type":"progress", "data":progress})).is_err() {
            cancelled.store(true, Ordering::Relaxed);
        }
    })?;
    emit(json!({"type":"report", "data":report})).map_err(|_| "Could not write scan report".into())
}

fn main() {
    let result = if std::env::args_os().len() == 1 { run() } else { Err("Unsupported scanner arguments.".into()) };
    if let Err(message) = result {
        let _ = emit(json!({"type":"error", "message":message}));
        std::process::exit(1);
    }
}
