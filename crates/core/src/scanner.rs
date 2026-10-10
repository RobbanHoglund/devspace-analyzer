use std::{fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use crate::{config::{self, Environment}, model::*, paths::{display, is_link, key, normalize, regular, small_text, within}};

const MAX_ENTRIES: u64 = 5_000_000;
const MAX_DEPTH: usize = 128;
const MAX_FINDINGS: usize = 20_000;
const MAX_PROJECTS: usize = 10_000;
const MARKERS: &[&str] = &["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "pom.xml", "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"];
const LOCKS: &[&str] = &["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "gradle.lockfile"];

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
#[derive(Default)]
struct Size { bytes: u64, files: u64, modified: Option<u64>, incomplete: bool }
impl Size {
    fn add(&mut self, other: Size) {
        self.bytes = self.bytes.saturating_add(other.bytes);
        self.files += other.files;
        self.modified = self.modified.max(other.modified);
        self.incomplete |= other.incomplete;
    }
    fn missing() -> Self { Self { incomplete: true, ..Self::default() } }
}
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
        let url = v.trim().split(['?', '#']).next()?;
        version(url.rsplit('/').next()?)
    })
}
fn project(root: &Path, index: usize) -> Option<Project> {
    let markers: Vec<String> = MARKERS.iter().filter(|m| regular(&root.join(m))).map(|s| s.to_string()).collect();
    let git = fs::symlink_metadata(root.join(".git")).ok().filter(|m| !is_link(m));
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
    let branch = if git_kind.as_deref() == Some("repository") {
        small_text(&root.join(".git/HEAD")).and_then(|s| s.trim().strip_prefix("ref: refs/heads/").map(str::to_owned))
    } else { None };
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
        let module = name.split('.').next().unwrap_or("");
        if !regular(&parent.join(format!("{module}.py"))) { return false; }
        found = true;
    }
    found
}

pub fn scan(request: ScanRequest, cancelled: &AtomicBool, progress: impl FnMut(Progress)) -> Result<Report, String> {
    scan_with_environment(request, &Environment::current(), cancelled, progress)
}
pub fn scan_with_environment(request: ScanRequest, env: &Environment, cancelled: &AtomicBool, progress: impl FnMut(Progress)) -> Result<Report, String> {
    if request.roots.len() > 32 || request.protected_paths.len() > 20_000 || request.roots.iter().chain(&request.protected_paths).any(|p| p.len() > 32_768) {
        return Err("Scan scope exceeds the supported limits.".into());
    }
    let globals = if request.include_global_caches { config::discover(env) } else { vec![] };
    let start = Instant::now();
    let report = Report {
        schema_version: 1, started_at: now(), duration_ms: 0, roots: vec![], global_caches: globals,
        findings: vec![], projects: vec![], progress: Progress::default(), warnings: vec![], warning_count: 0,
        complete: true, cancelled: false, size_basis: "Logical file lengths, not physical or guaranteed reclaimable bytes".into(),
        limitations: vec![
            "Only selected roots and discovered cache locations are scanned; other drives, users, WSL installations and Git branches are not resolved.".into(),
            "No builds, package-manager commands or Git commands are executed. Git tracking, dirty state, running tools and remote package availability are not verified.".into(),
            "Hardlinks, sparse files, compression and shared stores can make logical totals larger than the space a cleanup would release. No physical reclaim estimate is claimed.".into(),
            "File modification times are not last-use times. Missing wrapper matches do not prove that a Gradle version is unused.".into(),
            "Paths are checked for links and Windows reparse points. Concurrent filesystem changes remain a snapshot limitation; do not scan actively untrusted, mutating trees.".into(),
            "Environment overrides and selected user npm/Maven settings are recognized. pip.ini, project settings, Yarn configuration, CLI flags and custom Gradle init scripts are not evaluated.".into(),
            "At most 5 million entries, 20,000 findings, 10,000 projects and 128 directory levels are scanned. At most 500 warning details are retained.".into(),
        ],
    };
    let protected = request.protected_paths.iter().filter_map(|p| normalize(Path::new(p)).ok()).collect();
    let mut s = Scanner { report, cancelled, callback: progress, start, last_emit: start, stopped: false, protected };
    let mut roots = vec![];
    for raw in request.roots {
        match normalize(Path::new(&raw)) {
            Ok(root) => roots.push(root),
            Err(message) => s.warn(Path::new(&raw), "invalid-root", &message),
        }
    }
    roots.extend(s.report.global_caches.iter().map(|c| PathBuf::from(&c.path)));
    roots.sort_by_key(|p| (p.components().count(), key(p)));
    let mut unique: Vec<PathBuf> = vec![];
    for root in roots { if !unique.iter().any(|parent| within(&root, parent)) { unique.push(root); } }
    if unique.is_empty() { return Err("No accessible scan directories. Add a project folder or check your cache paths.".into()); }
    s.report.roots = unique.iter().map(|p| display(p)).collect();
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
        if self.report.progress.files + self.report.progress.directories >= MAX_ENTRIES {
            self.warn(path, "entry-limit", "Maximum entry count reached. Scan narrower roots."); self.stopped = true; return None;
        }
        self.report.progress.current_path = display(path); self.emit(false);
        match fs::symlink_metadata(path) {
            Ok(m) if is_link(&m) => { self.warn(path, "link-skipped", "Symbolic link, junction or reparse point was not followed."); None }
            Ok(m) => Some(m),
            Err(e) => { self.warn(path, "metadata-unavailable", &e.to_string()); None }
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
        Size { bytes: meta.len(), files: 1, modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|t| t.as_secs()), incomplete: false }
    }
    fn measure(&mut self, path: &Path, depth: usize) -> Size {
        let Some(meta) = self.metadata(path, depth) else { return Size::missing(); };
        if meta.is_file() { return self.file_size(&meta); }
        if !meta.is_dir() { self.warn(path, "special-file", "Special filesystem entry was not opened."); return Size::missing(); }
        if self.excluded(path) { return Size::missing(); }
        self.report.progress.directories += 1;
        let entries = match fs::read_dir(path) { Ok(e) => e, Err(e) => { self.warn(path, "directory-unavailable", &e.to_string()); return Size::missing(); } };
        let mut total = Size::default();
        for entry in entries {
            if self.halted() { total.incomplete = true; break; }
            match entry {
                Ok(e) => total.add(self.measure(&e.path(), depth + 1)),
                Err(e) => { self.warn(path, "entry-unavailable", &e.to_string()); total.incomplete = true; }
            }
        }
        total
    }
    fn visit(&mut self, path: &Path, owner: Option<usize>, depth: usize) {
        let Some(meta) = self.metadata(path, depth) else { return; };
        if let Some(rule) = self.rule(path, owner, meta.is_dir()) {
            if self.report.findings.len() >= MAX_FINDINGS { self.warn(path, "finding-limit", "Finding limit reached. Scan narrower roots."); self.stopped = true; return; }
            let size = self.measure(path, depth);
            let project_id = owner.map(|i| self.report.projects[i].id.clone());
            if let Some(i) = owner { self.report.projects[i].owned_logical_bytes += size.bytes; if rule.kind != "git-metadata" { self.report.projects[i].artifact_bytes += size.bytes; } }
            let protected = self.protected.iter().any(|p| within(path, p) || within(p, path));
            self.report.findings.push(Finding {
                id: format!("f{}", self.report.findings.len()), path: display(path), label: rule.label,
                ecosystem: rule.ecosystem, kind: rule.kind, risk: rule.risk, confidence: rule.confidence,
                logical_bytes: size.bytes, files: size.files, latest_modified: size.modified, project_id,
                evidence: rule.evidence, reason: rule.reason, recovery: rule.recovery,
                caveats: vec!["Review contents and close tools before considering any cleanup. Nothing is deleted by this application.".into(), "Tracked files, local modifications and remote availability have not been checked.".into(), "Logical bytes are not guaranteed space savings; links and sparse files can change the result.".into()],
                complete: !size.incomplete, user_protected: protected, wrapper_version: rule.wrapper_version, wrapper_references: vec![],
            });
            return;
        }
        if meta.is_file() {
            let size = self.file_size(&meta);
            if let Some(i) = owner { self.report.projects[i].owned_logical_bytes += size.bytes; }
            return;
        }
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
    fn rule(&self, path: &Path, owner: Option<usize>, directory: bool) -> Option<Rule> {
        let name = path.file_name()?.to_string_lossy();
        let exact = self.report.global_caches.iter().find(|g| key(Path::new(&g.path)) == key(path));
        if let Some(cache) = exact {
            if ["gradle-caches", "gradle-wrappers", "npm-cache"].contains(&cache.kind.as_str()) { return None; }
            let evidence = vec![format!("Location source: {}", cache.source)];
            return Some(match cache.kind.as_str() {
                "maven-repository" => Rule::new("Maven local repository", "Maven", "maven-repository", "protected", "May contain locally installed JARs and snapshots with no remote copy. Never treat the whole repository as disposable.", "Identify each artifact's origin and back up local-only artifacts before a selective review.", evidence),
                "toolchains" => Rule::new("Gradle Java toolchains", "Gradle", "toolchains", "protected", "Downloaded JDKs can be required by current builds. Wrapper versions alone do not establish JDK usage.", "Check project toolchain requirements and available replacement JDKs.", evidence),
                "virtual-disks" => Rule::new("Container virtual disks", "Containers", "virtual-disks", "protected", "Virtual disks may contain images, containers, volumes and user data. The logical file size is not physical disk use.", "Use the container platform's own inventory tools. Never delete a VHDX to reclaim cache space.", evidence),
                _ => Rule::new(&format!("{} shared cache", cache.kind), &cache.ecosystem, &cache.kind, "review", "Known package cache/store location. Its contents have not been matched to every installed environment or remote source.", "Review through the owning package manager. Downloads, builds and shared/hardlinked installations may be affected.", evidence),
            });
        }
        if let Some(cache) = self.report.global_caches.iter().find(|g| path.parent().is_some_and(|p| key(p) == key(Path::new(&g.path)))) {
            let evidence = vec![format!("Location source: {}", cache.source), format!("Cache category: {}", cache.kind)];
            if cache.kind == "gradle-wrappers" && directory {
                let mut rule = Rule::new("Gradle wrapper distribution", "Gradle", "gradle-wrapper", "review", "A local wrapper distribution. Reference checks cover only the wrappers discovered in this scan, not all usage.", "Gradle normally manages distribution cleanup. A removed distribution must be downloaded again before its next build.", evidence);
                rule.wrapper_version = version(&name);
                if rule.wrapper_version.is_none() { rule.risk = "protected".into(); rule.label = "Unrecognized wrapper storage".into(); }
                return Some(rule);
            }
            if cache.kind == "gradle-caches" && directory {
                let known = name.starts_with(|c: char| c.is_ascii_digit()) || ["modules-", "transforms-", "jars-", "build-cache-"].iter().any(|prefix| name.starts_with(prefix));
                return Some(Rule::new("Gradle cache", "Gradle", "gradle-cache", if known { "review" } else { "protected" }, "Gradle has its own automatic cache retention. Dependency caches can also be the only available offline copy.", "Inspect Gradle's retention settings before manual intervention. Rebuilds and dependency downloads may be needed.", evidence));
            }
            if cache.kind == "npm-cache" && directory {
                let label = match name.as_ref() { "_cacache" => "npm package cache", "_npx" => "npx environments", "_logs" => "npm diagnostic logs", _ => "Unrecognized npm storage" };
                return Some(Rule::new(label, "Node", "npm-cache", if ["_cacache", "_npx", "_logs"].contains(&name.as_ref()) { "review" } else { "protected" }, "Storage under the configured npm cache. npx environments, package content and diagnostic logs have different recovery costs.", "Review with npm's own cache tools. Even npm cache verify can change the cache; this scanner never runs it.", evidence));
            }
        }
        if !directory && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("vhdx")) {
            return Some(Rule::new("Virtual disk image", "Containers", "virtual-disk", "protected", "A VHDX can contain an entire operating system or persistent volume, not just a disposable cache.", "Inspect from the owning virtualization/container application. Do not delete the image directly.", vec!["VHDX filename extension; contents not opened".into()]));
        }
        let owner = owner?;
        let p = &self.report.projects[owner];
        let direct = path.parent().is_some_and(|parent| key(parent) == key(Path::new(&p.path)));
        let has = |ecosystem: &str| p.ecosystems.iter().any(|e| e == ecosystem);
        let evidence = vec![format!("Project markers: {}", p.markers.join(", ")), if p.lockfiles.is_empty() { "No recognized lockfile in this project directory".into() } else { format!("Lockfiles present: {} (not validated)", p.lockfiles.join(", ")) }];
        if name == ".git" && direct {
            return Some(Rule::new("Git metadata", "Git", "git-metadata", "protected", "Contains history, references or a worktree pointer. Not a build cache.", "Use Git's own repository maintenance after a backup; never delete this as cleanup.", vec!["Git repository/worktree marker".into()]));
        }
        if !directory { return None; }
        if name == "__pycache__" && has("Python") {
            let matched = bytecode_sources_present(path);
            return Some(Rule::new("Python bytecode cache", "Python", "python-bytecode", if matched { "low" } else { "protected" }, if matched { "Only .pyc filenames were found and each has a matching .py source filename in the parent directory. Sources were not executed or read." } else { "Bytecode recovery could not be established for every entry; source files may be absent or the directory may contain other data." }, "Python normally regenerates bytecode from source. Verify that sources and the required interpreter are available.", evidence));
        }
        if !direct { return None; }
        if has("Gradle") && ["build", ".gradle"].contains(&name.as_ref()) {
            return Some(Rule::new("Gradle project artifacts", "Gradle", "gradle-project", "review", "Conventional Gradle output/cache directory next to a recognized build. Custom outputs and tracked files remain possible.", "Review the project's configured outputs and back up unique files. A subsequent build recreates conventional outputs.", evidence));
        }
        if has("Maven") && name == "target" {
            return Some(Rule::new("Maven project output", "Maven", "maven-output", "review", "Conventional target directory next to pom.xml; custom or tracked files have not been excluded.", "Review the contents and project configuration. Rebuilding can recreate normal Maven output.", evidence));
        }
        if has("Node") && ["node_modules", "dist", "build", ".next", ".nuxt", ".parcel-cache", ".turbo"].contains(&name.as_ref()) {
            let modules = name == "node_modules";
            return Some(Rule::new(if modules { "Installed Node dependencies" } else { "Possible Node build artifacts" }, "Node", if modules { "node-modules" } else { "node-output" }, "review", if modules { "Installed dependencies next to package.json. Lockfiles help but do not prove recovery of local packages, patches, install scripts or unpublished versions." } else { "Conventional build/cache directory next to package.json. Directory naming alone does not establish that every file is disposable." }, "Check the lockfile, local/file dependencies, package availability and any manual patches before reinstalling or rebuilding.", evidence));
        }
        if has("Node") && name == ".yarn" {
            return Some(Rule::new("Project Yarn storage", "Node", "yarn-project", "protected", "May include tracked Zero-Install packages, patches, releases and plugins, not just cache.", "Review the Yarn project configuration and tracked files individually.", evidence));
        }
        if has("Python") && [".venv", "venv"].contains(&name.as_ref()) {
            return Some(Rule::new("Python virtual environment", "Python", "python-venv", if regular(&path.join("pyvenv.cfg")) { "review" } else { "protected" }, "A virtual environment may contain manually installed or editable local packages. A manifest/lockfile is not a complete recovery guarantee.", "Record the interpreter and package origins, check local/editable dependencies, then rebuild from a verified lock or requirements file.", evidence));
        }
        if has("Python") && [".pytest_cache", ".mypy_cache", ".ruff_cache"].contains(&name.as_ref()) {
            return Some(Rule::new("Python tooling cache", "Python", "python-tool-cache", "review", "Conventional tool cache next to a Python project. Tracking and unique files have not been verified.", "The owning tool usually rebuilds its cache; review the directory and close running jobs first.", evidence));
        }
        None
    }
}
