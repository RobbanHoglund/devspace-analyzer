//! Explicit, single-use cache maintenance. Scanning never calls this module.
mod process;
mod protocol;
mod tools;
pub use protocol::serve;
use crate::{config::{self, Environment}, model::{CacheLocation, Finding, Report}, paths};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
use tempfile::TempDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action { NpmVerify, NpmClean, PnpmPrune, PipPurge }
impl Action {
    fn kind(self) -> &'static str { match self { Self::NpmVerify | Self::NpmClean => "npm-cache", Self::PnpmPrune => "pnpm-store", Self::PipPurge => "pip-cache" } }
    fn title(self) -> &'static str { match self { Self::NpmVerify => "Verify npm cache", Self::NpmClean => "Clear npm package cache", Self::PnpmPrune => "Prune pnpm store", Self::PipPurge => "Purge pip cache" } }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request { pub action: Action, pub finding: Finding, pub cache: CacheLocation, pub protected_paths: Vec<String> }

/// Hosts resolve IDs against their latest native report, never a webview-supplied path.
pub fn request(report: &Report, id: &str, action: Action, protected_paths: Vec<String>) -> Result<Request, String> {
    if !report.complete || report.cancelled { return Err("Complete the scan before preparing cleanup.".into()); }
    let finding = report.findings.iter().find(|f| f.id == id).ok_or("Finding is not in the current scan.")?;
    let cache = report.global_caches.iter().find(|c| c.kind == action.kind() && paths::within(Path::new(&finding.path), Path::new(&c.path))).ok_or("No matching cache in this scan.")?;
    if report.projects.iter().any(|p| overlaps(Path::new(&p.path), Path::new(&cache.path))) {
        return Err("This cache overlaps a detected project. Use manual review.".into());
    }
    let value = Request { action, finding: finding.clone(), cache: cache.clone(), protected_paths };
    validate_request(&value)?; Ok(value)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String, pub action: Action, pub title: String, pub tool_version: String,
    pub cache_path: String, pub target_path: String, pub executable: String, pub arguments: Vec<String>,
    pub command: String, pub shell: String, pub before_bytes: u64, pub before_files: u64, pub effects: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: String, pub exit_code: Option<i32>, pub before_bytes: u64, pub after_bytes: Option<u64>,
    pub measurement_error: Option<String>, pub log: String,
}
pub struct Prepared {
    pub plan: Plan, request: Request, command: tools::Tool, sandbox: TempDir, created: Instant,
}
fn overlaps(a: &Path, b: &Path) -> bool {
    let key = |p: &Path| { let text = paths::key(p); text.strip_prefix("//?/").unwrap_or(&text).trim_end_matches('/').to_owned() };
    let (a, b) = (key(a), key(b));
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}
fn validate_request(request: &Request) -> Result<(), String> {
    let f = &request.finding;
    if f.kind != request.action.kind() || request.cache.kind != request.action.kind() || !f.complete || f.user_protected || f.risk == "protected" || f.protected_descendant_count > 0 || !f.protected_descendants.is_empty() {
        return Err("Only complete, unprotected npm, pnpm and pip cache findings support cleanup.".into());
    }
    let cache = paths::normalize(Path::new(&request.cache.path))?;
    let expected = if request.action.kind() == "npm-cache" { cache.join("_cacache") } else { cache.clone() };
    if paths::key(&expected) != paths::key(Path::new(&f.path)) {
        return Err("Select the entire cache finding. npm cleanup applies only to _cacache, not npx or logs.".into());
    }
    if request.protected_paths.len() > 20_000 { return Err("Too many protection rules.".into()); }
    for protected in &request.protected_paths {
        // Fail closed even for missing or newly inaccessible protection rules.
        let path = Path::new(protected);
        if !path.is_absolute() || path.components().any(|p| matches!(p, std::path::Component::ParentDir)) {
            return Err("A protection rule is invalid. Review protection settings first.".into());
        }
        if overlaps(path, &cache) || fs::canonicalize(path).is_ok_and(|p| overlaps(&p, &cache)) {
            return Err("This cache overlaps a protected path. Cleanup is blocked.".into());
        }
    }
    Ok(())
}
fn current_cache(request: &Request) -> Result<PathBuf, String> {
    validate_request(request)?;
    let environment = Environment::current();
    let cache = paths::normalize(Path::new(&request.cache.path))?;
    let locations = config::discover(&environment);
    if !locations.iter().any(|c| c.kind == request.action.kind() && paths::key(Path::new(&c.path)) == paths::key(&cache)) {
        return Err("The configured cache changed or cannot be identified. Scan again.".into());
    }
    if locations.iter().any(|c| matches!(c.kind.as_str(), "maven-repository" | "toolchains" | "virtual-disks") && overlaps(Path::new(&c.path), &cache)) {
        return Err("The cache overlaps intrinsically protected storage. Cleanup is blocked.".into());
    }
    let home = fs::canonicalize(&environment.home).map_err(|_| "Cannot validate the home directory.")?;
    if cache.parent().is_none() || paths::within(&home, &cache) {
        return Err("A home directory or filesystem root cannot be a cleanup target.".into());
    }
    Ok(cache)
}

/// Preparation probes only tool versions/store paths; it never runs maintenance.
pub fn prepare(request: Request, cancelled: &AtomicBool) -> Result<Prepared, String> {
    let cache = current_cache(&request)?;
    let sandbox = tempfile::Builder::new().prefix("devspace-cleanup-").tempdir().map_err(|_| "Could not create an isolated working directory.")?;
    let command = tools::resolve(request.action, &cache)?;
    let version = command.version(sandbox.path(), cancelled)?;
    tools::supported(request.action, &version)?;
    let target = match request.action {
        Action::NpmVerify | Action::NpmClean => cache.join("_cacache"),
        Action::PipPurge => cache.clone(),
        Action::PnpmPrune => {
            let output = command.probe_store(&cache, sandbox.path(), cancelled)?;
            let target = paths::normalize(Path::new(output.trim()))?;
            if !paths::within(&target, &cache) { return Err("pnpm resolved a store outside the selected cache.".into()); }
            target
        }
    };
    let (before_bytes, before_files) = measure(&target, cancelled)?;
    let arguments = command.arguments(request.action, &cache);
    let executable = paths::display(&command.executable);
    let (command_text, shell) = tools::display_command(&executable, &arguments);
    let mut effects = vec![match request.action {
        Action::NpmVerify => "Checks package integrity and removes unneeded or corrupt cache data. Verification changes the cache; it is not a dry run.",
        Action::NpmClean => "Removes npm's package cache (_cacache). Installed node_modules, npx environments and existing diagnostic logs are outside this action.",
        Action::PnpmPrune => "Asks pnpm to remove unreferenced store packages. Hardlinks mean the logical size reduction may exceed space actually freed.",
        Action::PipPurge => "Removes pip's cached HTTP downloads and wheels. Installed Python environments are outside this action.",
    }.into(), "Removed downloads may be needed again, including for offline work. Close package managers and builds first. There is no undo.".into(),
    "The app runs the installed tool with isolated configuration in a temporary working directory. This preview is a command plan, not a list of files guaranteed to be deleted.".into()];
    if request.action == Action::PnpmPrune { effects.push("Only the active store version below is maintained; other version directories remain.".into()); }
    let plan = Plan { id: sandbox.path().file_name().unwrap().to_string_lossy().into(), action: request.action, title: request.action.title().into(), tool_version: version,
        cache_path: paths::display(&cache), target_path: paths::display(&target), executable, arguments, command: command_text, shell,
        before_bytes, before_files, effects };
    Ok(Prepared { plan, request, command, sandbox, created: Instant::now() })
}
impl Prepared {
    /// Consuming self makes a plan single-use, including failed/cancelled attempts.
    pub fn run(self, cancelled: &AtomicBool, mut log: impl FnMut(&str)) -> Result<Outcome, String> {
        if self.created.elapsed() > Duration::from_secs(300) { return Err("This preview expired. Prepare it again.".into()); }
        let cache = current_cache(&self.request)?;
        self.command.revalidate()?;
        if self.request.action == Action::PnpmPrune {
            let current = self.command.probe_store(&cache, self.sandbox.path(), cancelled)?;
            if paths::key(&paths::normalize(Path::new(current.trim()))?) != paths::key(Path::new(&self.plan.target_path)) {
                return Err("The active pnpm store changed. Prepare a new preview.".into());
            }
        }
        let (before_bytes, files) = measure(Path::new(&self.plan.target_path), cancelled)?;
        if (before_bytes, files) != (self.plan.before_bytes, self.plan.before_files) {
            return Err("Cache contents changed since the preview. Prepare it again.".into());
        }
        log("Starting native cache maintenance. Changes cannot be undone.\n");
        let execution = self.command.execute(&self.plan.arguments, self.sandbox.path(), cancelled, Duration::from_secs(600), &mut log)?;
        log("Measuring the same cache again…\n");
        // Cancellation stops the command, but a bounded after-measurement still runs.
        let after = measure_after(Path::new(&self.plan.target_path));
        let (after_bytes, measurement_error) = match after { Ok((bytes, _)) => (Some(bytes), None), Err(e) => (None, Some(e)) };
        Ok(Outcome { status: execution.status, exit_code: execution.code, before_bytes, after_bytes, measurement_error, log: execution.log })
    }
}

fn measure_after(path: &Path) -> Result<(u64, u64), String> {
    // npm clean can remove _cacache itself. Validate the parent before accepting zero.
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            paths::normalize(path.parent().ok_or("Cache parent unavailable")?)?; Ok((0, 0))
        },
        _ => measure(path, &AtomicBool::new(false)),
    }
}
fn measure(root: &Path, cancelled: &AtomicBool) -> Result<(u64, u64), String> {
    let root = paths::normalize(root)?;
    let start = Instant::now();
    let mut queue = vec![(root, 0)]; let mut total = 0u64; let mut files = 0u64; let mut entries = 0usize;
    while let Some((path, depth)) = queue.pop() {
        if cancelled.load(Ordering::Relaxed) { return Err("Cleanup cancelled.".into()); }
        if depth > 128 || entries > 2_000_000 || start.elapsed() > Duration::from_secs(30) { return Err("Cache validation exceeded its limits. Use manual review.".into()); }
        // Revalidate ancestors on every descent; no symlink/junction traversal.
        if !paths::safe_path(&path) { return Err("Cache contains a link or inaccessible path. Cleanup is blocked.".into()); }
        let meta = fs::symlink_metadata(&path).map_err(|_| "Cannot read every cache entry. Cleanup is blocked.")?;
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if paths::is_link(&meta) || [".git", ".yarn", ".venv", "venv"].iter().any(|s| name.eq_ignore_ascii_case(s)) || path.extension().is_some_and(|s| s.eq_ignore_ascii_case("vhdx")) {
            return Err("Cache contains protected storage or links. Cleanup is blocked.".into());
        }
        entries += 1;
        if meta.is_dir() {
            for child in fs::read_dir(path).map_err(|_| "Cannot read cache directory.")? {
                let child = child.map_err(|_| "Cannot read cache entry.")?;
                queue.push((child.path(), depth + 1));
                if queue.len() + entries > 2_000_000 { return Err("Cache validation exceeded its entry limit.".into()); }
            }
        } else if meta.is_file() {
            total = total.checked_add(meta.len()).ok_or("Cache size overflow.")?; files += 1;
        } else { return Err("Cache contains a special file. Cleanup is blocked.".into()); }
    }
    Ok((total, files))
}

#[cfg(test)] mod tests;
