use std::{env, io::Read, path::Path, process::{Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, mpsc}, time::{Duration, Instant}};
pub(super) struct Execution { pub status: String, pub code: Option<i32>, pub log: String }
const LOG_LIMIT: usize = 128 * 1024;
/// No shell, inherited npm/pip/Python/Node overrides, project cwd or stdin prompts.
pub(super) fn run(program: &Path, args: &[String], cwd: &Path, cancelled: &AtomicBool, timeout: Duration, log: &mut impl FnMut(&str)) -> Result<Execution, String> {
    if cancelled.load(Ordering::Relaxed) { return Err("Cleanup cancelled.".into()); }
    let mut command = Command::new(program);
    command.args(args).current_dir(cwd).env_clear().stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for name in ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR"] {
        if let Some(value) = env::var_os(name) { command.env(name, value); }
    }
    command.env("HOME", cwd).env("USERPROFILE", cwd).env("APPDATA", cwd).env("LOCALAPPDATA", cwd)
        .env("XDG_CONFIG_HOME", cwd).env("XDG_CACHE_HOME", cwd).env("XDG_DATA_HOME", cwd).env("XDG_STATE_HOME", cwd)
        .env("NPM_CONFIG_USERCONFIG", cwd.join("user.npmrc")).env("NPM_CONFIG_GLOBALCONFIG", cwd.join("global.npmrc"))
        .env("PIP_CONFIG_FILE", if cfg!(windows) { "NUL" } else { "/dev/null" })
        .env("NO_COLOR", "1").env("CI", "1").env("LANG", "C.UTF-8");
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|_| "Could not start the installed tool. Check its installation and permissions.")?;
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(64);
    let readers: Vec<Box<dyn Read + Send>> = vec![Box::new(child.stdout.take().unwrap()), Box::new(child.stderr.take().unwrap())];
    for mut reader in readers {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut bytes = [0; 2048];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => { if tx.send(bytes[..n].to_vec()).is_err() { break; } }
                }
            }
        });
    }
    drop(tx);
    let start = Instant::now(); let mut output = String::new(); let mut emitted = 0usize; let mut status = None;
    loop {
        if cancelled.load(Ordering::Relaxed) && status.is_none() { status = Some("cancelled"); let _ = child.kill(); }
        if start.elapsed() > timeout && status.is_none() { status = Some("timed-out"); let _ = child.kill(); }
        match rx.recv_timeout(Duration::from_millis(30)) {
            Ok(chunk) => {
                if emitted < LOG_LIMIT {
                    let text: String = String::from_utf8_lossy(&chunk).chars().filter(|c| !c.is_control() || ['\n', '\r', '\t'].contains(c)).collect();
                    emitted += chunk.len(); output.push_str(&text); log(&text);
                    if emitted >= LOG_LIMIT { output.push_str("\n[Log truncated at 128 KiB]\n"); log("\n[Log truncated at 128 KiB]\n"); }
                }
            },
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(exit) = child.try_wait().map_err(|_| "Could not read tool exit status.")? {
                    return Ok(Execution { status: status.unwrap_or(if exit.success() { "succeeded" } else { "failed" }).into(), code: exit.code(), log: output });
                }
                std::thread::sleep(Duration::from_millis(20));
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {},
        }
    }
}
