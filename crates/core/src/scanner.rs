use std::{collections::BTreeSet, fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use crate::{config::{self, Environment}, model::*, paths::{display, git_marker, is_link, key, normalize, regular, small_text, within}};
mod rules;

const MAX_ENTRIES: u64 = 5_000_000;
const MAX_DEPTH: usize = 128;
const MAX_FINDINGS: usize = 20_000;
const MAX_PROJECTS: usize = 10_000;
const MARKERS: &[&str] = &["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "pom.xml", "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"];
const LOCKS: &[&str] = &["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "gradle.lockfile"];
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }

#[derive(Default)]
struct Size {
    bytes: u64, files: u64, modified: Option<u64>, incomplete: bool,
    // Distinct fixed rule labels, not an unbounded list of every sensitive path.
    guards: BTreeSet<String>,
}
impl Size {
    fn add(&mut self, other: Size) {
        self.bytes = self.bytes.saturating_add(other.bytes); self.files += other.files;
        self.modified = self.modified.max(other.modified); self.incomplete |= other.incomplete;
        self.guards.extend(other.guards);
    }
    fn missing() -> Self { Self { incomplete: true, ..Self::default() } }
}
struct Aggregate { root: PathBuf, owner: Option<usize>, artifact: bool }
struct Rule {
    label: String, ecosystem: String, kind: String, risk: String, confidence: String,
    reason: String, recovery: String, evidence: Vec<String>, wrapper_version: Option<String>,
}
impl Rule {
    fn new(label: &str, ecosystem: &str, kind: &str, risk: &str, reason: &str, recovery: &str, evidence: Vec<String>) -> Self {
        Self { label: label.into(), ecosystem: ecosystem.into(), kind: kind.into(), risk: risk.into(), confidence: "contextual".into(), reason: reason.into(), recovery: recovery.into(), evidence, wrapper_version: None }
    }
}
fn version(name: &str) -> Option<String> {
    let name = name.strip_prefix("gradle-")?;
    let name = name.strip_suffix(".zip").unwrap_or(name);
    let value = name.strip_suffix("-bin").or_else(|| name.strip_suffix("-all"))?;
    (!value.is_empty() && value.len() <= 64 && value.starts_with(|c: char| c.is_ascii_digit()) && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')).then(|| value.into())
}
fn wrapper_version(root: &Path) -> Option<String> {
    let text = small_text(&root.join("gradle/wrapper/gradle-wrapper.properties"))?;
    text.lines().find_map(|line| {
        let (k, v) = line.trim().split_once('=')?;
        if k.trim() != "distributionUrl" { return None; }
        version(v.trim().split(['?', '#']).next()?.rsplit('/').next()?)
    })
}
fn project(root: &Path, index: usize) -> Option<Project> {
    let markers: Vec<String> = MARKERS.iter().filter(|m| regular(&root.join(m))).map(|s| s.to_string()).collect();
    let git = if git_marker(&root.join(".git")) { fs::symlink_metadata(root.join(".git")).ok() } else { None };
    let git_kind = git.as_ref().and_then(|m| if m.is_dir() { Some("repository") } else if m.is_file() { Some("worktree") } else { None }).map(str::to_string);
    let has_wrapper = regular(&root.join("gradle/wrapper/gradle-wrapper.properties"));
    if markers.is_empty() && git_kind.is_none() && !has_wrapper { return None; }
    let has = |s: &str| markers.iter().any(|m| m == s);
    let mut ecosystems = vec![];
    if has_wrapper || markers.iter().any(|m| m.ends_with(".gradle") || m.ends_with(".gradle.kts")) { ecosystems.push("Gradle".into()); }
    if has("pom.xml") { ecosystems.push("Maven".into()); }
    if has("package.json") { ecosystems.push("Node".into()); }
    if ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"].iter().any(|m| has(m)) { ecosystems.push("Python".into()); }
    if ecosystems.is_empty() { ecosystems.push("Git".into()); }
    let branch = if git_kind.as_deref() == Some("repository") { small_text(&root.join(".git/HEAD")).and_then(|s| s.trim().strip_prefix("ref: refs/heads/").map(str::to_owned)) } else { None };
    let workspace = regular(&root.join("pnpm-workspace.yaml")) || small_text(&root.join("package.json")).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).is_some_and(|v| v.get("workspaces").is_some());
    Some(Project {
        id: format!("p{index}"), name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| display(root)), path: display(root),
        ecosystems, markers, lockfiles: LOCKS.iter().filter(|m| regular(&root.join(m))).map(|s| s.to_string()).collect(),
        git_kind, branch, wrapper_version: wrapper_version(root), workspace, owned_logical_bytes: 0, artifact_bytes: 0,
    })
}
fn bytecode_sources_present(path: &Path) -> bool {
    let Some(parent) = path.parent() else { return false; };
    let Ok(entries) = fs::read_dir(path) else { return false; };
    let mut found = false;
    for (index, item) in entries.enumerate() {
        if index > 10_000 { return false; }
        let Ok(entry) = item else { return false; };
        let p = entry.path();
        if !regular(&p) || p.extension().and_then(|e| e.to_str()) != Some("pyc") { return false; }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !regular(&parent.join(format!("{}.py", name.split('.').next().unwrap_or("")))) { return false; }
        found = true;
    }
    found
}

pub fn scan(request: ScanRequest, cancelled: &AtomicBool, progress: impl FnMut(Progress)) -> Result<Report, String> {
    scan_with_environment(request, &Environment::current(), cancelled, progress)
}
pub fn scan_with_environment(request: ScanRequest, env: &Environment, cancelled: &AtomicBool, progress: impl FnMut(Progress)) -> Result<Report, String> {
    if request.roots.len() > 32 || request.protected_paths.len() > 20_000 || request.roots.iter().chain(&request.protected_paths).any(|p| p.len() > 32_768) { return Err("Scan scope exceeds the supported limits.".into()); }
    let start = Instant::now();
    // Recognition remains available when automatic inclusion is off. Only the
    // later roots.extend() determines whether unrelated caches are traversed.
    let discovery = config::discover_with_warnings(env);
    let report = Report {
        schema_version: 1, started_at: now(), duration_ms: 0, roots: vec![], global_caches: discovery.locations,
        findings: vec![], projects: vec![], progress: Progress::default(), warnings: vec![], warning_count: 0,
        complete: true, cancelled: false, size_basis: "Logical file lengths, not physical or guaranteed reclaimable bytes".into(),
        limitations: vec![
            "Only selected roots and optionally included caches are traversed. User configuration is read for cache identity even when auto-inclusion is off; no unrelated cache files are measured.".into(),
            "No builds, package-manager commands or Git commands are executed. Git tracking, dirty state, other branches, running tools and remote package availability are not verified.".into(),
            "Hardlinks, sparse files, compression and shared stores can make logical totals larger than the space a cleanup would release. No physical reclaim estimate is claimed.".into(),
            "File modification times are not last-use times. Missing wrapper matches do not prove that a Gradle version is unused.".into(),
            "Paths and marker probes reject links and Windows reparse points. Concurrent filesystem changes remain a snapshot limitation; do not scan actively untrusted, mutating trees.".into(),
            "Selected environment and user npm/Maven settings are recognized. Project settings, pip.ini, Yarn configuration, CLI flags and custom Gradle init scripts are not evaluated.".into(),
            "A protected descendant protects the whole enclosing aggregate. Explicit nested Git projects are recorded with exclusive owned bytes; their inner artifacts are not separately classified inside that aggregate.".into(),
            "At most 5 million entries, 20,000 findings, 10,000 projects and 128 directory levels are scanned. At most 500 warning details are retained.".into(),
        ],
    };
    let protected = request.protected_paths.iter().filter_map(|p| normalize(Path::new(p)).ok()).collect();
    let mut s = Scanner { report, cancelled, callback: progress, start, last_emit: start, stopped: false, protected };
    for warning in discovery.warnings { s.warn(Path::new(&warning.path), &warning.code, &warning.message); }
    let mut roots = vec![];
    for raw in request.roots {
        match normalize(Path::new(&raw)) { Ok(root) => roots.push(root), Err(message) => s.warn(Path::new(&raw), "invalid-root", &message) }
    }
    if request.include_global_caches { roots.extend(s.report.global_caches.iter().map(|c| PathBuf::from(&c.path))); }
    roots.sort_by_key(|p| (p.components().count(), key(p)));
    let mut unique: Vec<PathBuf> = vec![];
    for root in roots { if !unique.iter().any(|parent| within(&root, parent)) { unique.push(root); } }
    if unique.is_empty() { return Err("No accessible scan directories. Add a project folder or check your cache paths.".into()); }
    s.report.roots = unique.iter().map(|p| display(p)).collect();
    s.report.global_caches.retain(|c| unique.iter().any(|r| within(Path::new(&c.path), r) || within(r, Path::new(&c.path))));
    for root in &unique { s.visit(root, None, 0); if s.halted() { break; } }
    for finding in &mut s.report.findings {
        if let Some(version) = &finding.wrapper_version {
            finding.wrapper_references = s.report.projects.iter().filter(|p| p.wrapper_version.as_ref() == Some(version)).map(|p| p.id.clone()).collect();
            finding.evidence.push(if finding.wrapper_references.is_empty() { "No matching Gradle wrapper found within this scan; this is not proof of disuse.".into() } else { format!("Referenced by {} discovered project wrapper(s).", finding.wrapper_references.len()) });
        }
    }
    s.report.cancelled = cancelled.load(Ordering::Relaxed);
    s.report.complete &= !s.report.cancelled && !s.stopped;
    s.report.duration_ms = s.start.elapsed().as_millis() as u64;
    s.emit(true);
    Ok(s.report)
}
struct Scanner<'a, F: FnMut(Progress)> {
    report: Report, cancelled: &'a AtomicBool, callback: F, start: Instant,
    last_emit: Instant, stopped: bool, protected: Vec<PathBuf>,
}
impl<F: FnMut(Progress)> Scanner<'_, F> {
    fn halted(&self) -> bool { self.stopped || self.cancelled.load(Ordering::Relaxed) }
    fn warn(&mut self, path: &Path, code: &str, message: &str) {
        self.report.warning_count += 1; self.report.complete = false;
        if self.report.warnings.len() < 500 { self.report.warnings.push(ScanWarning { path: display(path), code: code.into(), message: message.into() }); }
    }
    fn emit(&mut self, force: bool) {
        if force || self.last_emit.elapsed() > Duration::from_millis(150) {
            self.report.progress.projects = self.report.projects.len();
            (self.callback)(self.report.progress.clone()); self.last_emit = Instant::now();
        }
    }
    fn metadata(&mut self, path: &Path, depth: usize) -> Option<fs::Metadata> {
        if self.halted() { return None; }
        if depth > MAX_DEPTH { self.warn(path, "depth-limit", "Maximum directory depth reached."); return None; }
        if self.report.progress.files + self.report.progress.directories >= MAX_ENTRIES { self.warn(path, "entry-limit", "Maximum entry count reached. Scan narrower roots."); self.stopped = true; return None; }
        self.report.progress.current_path = display(path); self.emit(false);
        // A progress callback can request cancellation too.
        if self.halted() { return None; }
        match fs::symlink_metadata(path) {
            Ok(m) if is_link(&m) => { self.warn(path, "link-skipped", "Symbolic link, junction or reparse point was not followed."); None }
            Ok(m) => Some(m), Err(e) => { self.warn(path, "metadata-unavailable", &e.to_string()); None }
        }
    }
    fn excluded(&mut self, path: &Path) -> bool {
        let name = path.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let drive_child = path.parent().is_some_and(|p| p.parent().is_none());
        if name == ".ssh" || name == ".gnupg" || (drive_child && ["windows", "program files", "program files (x86)", "programdata", "system volume information", "$recycle.bin", "recovery"].contains(&name.as_str())) {
            self.warn(path, "policy-excluded", "Sensitive/system directory excluded by the default policy."); true
        } else { false }
    }
    fn file_size(&mut self, meta: &fs::Metadata) -> Size {
        self.report.progress.files += 1;
        self.report.progress.logical_bytes = self.report.progress.logical_bytes.saturating_add(meta.len());
        Size { bytes: meta.len(), files: 1, modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|t| t.as_secs()), ..Size::default() }
    }
    fn charge(&mut self, owner: Option<usize>, bytes: u64, artifact: bool) {
        if let Some(i) = owner {
            self.report.projects[i].owned_logical_bytes += bytes;
            if artifact { self.report.projects[i].artifact_bytes += bytes; }
        }
    }
    /// A single traversal measures an aggregate AND checks its safety boundaries.
    /// No child findings are added, so summing findings cannot double-count bytes.
    fn measure(&mut self, path: &Path, depth: usize, owner: Option<usize>, aggregate: &Aggregate, in_git: bool) -> Size {
        let Some(meta) = self.metadata(path, depth) else { return Size::missing(); };
        let mut guards = BTreeSet::new();
        let name_is_git = path.file_name().is_some_and(|n| n.eq_ignore_ascii_case(".git"));
        if meta.is_dir() || name_is_git || path.extension().is_some_and(|e| e.eq_ignore_ascii_case("vhdx")) {
            if let Some(rule) = self.rule(path, owner, meta.is_dir()) {
                if rule.risk == "protected" && path != aggregate.root { guards.insert(format!("Protected descendant category: {}", rule.label)); }
            }
        }
        if meta.is_file() {
            let mut size = self.file_size(&meta);
            self.charge(owner, size.bytes, owner == aggregate.owner && aggregate.artifact);
            size.guards = guards; return size;
        }
        if !meta.is_dir() { self.warn(path, "special-file", "Special filesystem entry was not opened."); return Size::missing(); }
        if self.excluded(path) { return Size::missing(); }
        self.report.progress.directories += 1;
        let mut next_owner = owner;
        if !in_git && !name_is_git && git_marker(&path.join(".git")) && !owner.is_some_and(|i| key(Path::new(&self.report.projects[i].path)) == key(path)) {
            guards.insert("Explicit nested Git project inside this aggregate".into());
            if self.report.projects.len() >= MAX_PROJECTS { self.warn(path, "project-limit", "Project limit reached."); self.stopped = true; return Size::missing(); }
            if let Some(p) = project(path, self.report.projects.len()) { next_owner = Some(self.report.projects.len()); self.report.projects.push(p); }
        }
        let entries = match fs::read_dir(path) { Ok(e) => e, Err(e) => { self.warn(path, "directory-unavailable", &e.to_string()); return Size::missing(); } };
        let mut total = Size { guards, ..Size::default() };
        for entry in entries {
            if self.halted() { total.incomplete = true; break; }
            match entry {
                Ok(e) => total.add(self.measure(&e.path(), depth + 1, next_owner, aggregate, in_git || name_is_git)),
                Err(e) => { self.warn(path, "entry-unavailable", &e.to_string()); total.incomplete = true; }
            }
        }
        total
    }
    fn visit(&mut self, path: &Path, owner: Option<usize>, depth: usize) {
        let Some(meta) = self.metadata(path, depth) else { return; };
        if let Some(mut rule) = self.rule(path, owner, meta.is_dir()) {
            if self.report.findings.len() >= MAX_FINDINGS { self.warn(path, "finding-limit", "Finding limit reached. Scan narrower roots."); self.stopped = true; return; }
            let aggregate = Aggregate { root: path.to_path_buf(), owner, artifact: rule.kind != "git-metadata" };
            let size = self.measure(path, depth, owner, &aggregate, false);
            if !size.guards.is_empty() {
                rule.risk = "protected".into();
                rule.reason = format!("Protected content was found inside this directory. The entire aggregate is excluded from review candidates. Original category: {}.", rule.label);
                rule.recovery = "Do not remove this directory as a whole. Inspect the protected descendants and preserve unique data; only a separately verified narrower cleanup plan could be considered.".into();
                rule.evidence.extend(size.guards);
            }
            let protected = self.protected.iter().any(|p| within(path, p) || within(p, path));
            self.report.findings.push(Finding {
                id: format!("f{}", self.report.findings.len()), path: display(path), label: rule.label,
                ecosystem: rule.ecosystem, kind: rule.kind, risk: rule.risk, confidence: rule.confidence,
                logical_bytes: size.bytes, files: size.files, latest_modified: size.modified, project_id: owner.map(|i| self.report.projects[i].id.clone()),
                evidence: rule.evidence, reason: rule.reason, recovery: rule.recovery,
                caveats: vec!["Review contents and close tools before considering any cleanup. Nothing is deleted by this application.".into(), "Tracked files, local modifications and remote availability have not been checked.".into(), "Logical bytes are not guaranteed space savings; links and sparse files can change the result.".into()],
                complete: !size.incomplete, user_protected: protected, wrapper_version: rule.wrapper_version, wrapper_references: vec![],
            });
            return;
        }
        if meta.is_file() { let size = self.file_size(&meta); self.charge(owner, size.bytes, false); return; }
        if !meta.is_dir() { self.warn(path, "special-file", "Special filesystem entry was not opened."); return; }
        if self.excluded(path) { return; }
        self.report.progress.directories += 1;
        let mut next_owner = owner;
        if let Some(p) = project(path, self.report.projects.len()) {
            if self.report.projects.len() >= MAX_PROJECTS { self.warn(path, "project-limit", "Project limit reached."); self.stopped = true; return; }
            next_owner = Some(self.report.projects.len()); self.report.projects.push(p);
        }
        match fs::read_dir(path) {
            Ok(entries) => for entry in entries {
                if self.halted() { break; }
                match entry { Ok(e) => self.visit(&e.path(), next_owner, depth + 1), Err(e) => self.warn(path, "entry-unavailable", &e.to_string()) }
            },
            Err(e) => self.warn(path, "directory-unavailable", &e.to_string()),
        }
    }
}
