use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};
use tempfile::TempDir;
use crate::{config::{discover, Environment}, model::*, scan_with_environment};

struct Fixture { temp: TempDir, home: PathBuf, workspace: PathBuf }
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home"); let workspace = temp.path().join("workspaces");
        fs::create_dir_all(&home).unwrap(); fs::create_dir_all(&workspace).unwrap();
        Self { temp, home, workspace }
    }
    fn env(&self) -> Environment { Environment { home: self.home.clone(), vars: HashMap::new(), platform: std::env::consts::OS.into() } }
    fn put(&self, path: impl AsRef<Path>, data: &[u8]) { put(path.as_ref(), data); }
    fn scan(&self) -> Report {
        scan_with_environment(ScanRequest { roots: vec![self.workspace.to_string_lossy().into_owned()], include_global_caches: true, protected_paths: vec![] }, &self.env(), &AtomicBool::new(false), |_| {}).unwrap()
    }
}
fn put(path: &Path, data: &[u8]) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, data).unwrap(); }
fn of_kind<'a>(r: &'a Report, kind: &str) -> &'a Finding { r.findings.iter().find(|f| f.kind == kind).unwrap_or_else(|| panic!("No {kind} finding: {:?}", r.findings)) }

#[test]
fn node_dependencies_are_contextual_and_not_projects_themselves() {
    let f = Fixture::new(); let root = f.workspace.join("web");
    put(&root.join("package.json"), br#"{"workspaces":["packages/*"]}"#);
    put(&root.join("pnpm-lock.yaml"), b"lockfileVersion: 9");
    put(&root.join("node_modules/nested/package.json"), b"{}");
    put(&root.join("node_modules/nested/index.js"), &[1; 4096]);
    let r = f.scan(); assert_eq!(r.projects.len(), 1); assert!(r.projects[0].workspace);
    let finding = of_kind(&r, "node-modules"); assert_eq!(finding.risk, "review"); assert_eq!(finding.logical_bytes, 4098); assert_eq!(finding.project_id.as_deref(), Some("p0"));
}
#[test]
fn generic_directory_names_are_not_cleanup_evidence() {
    let f = Fixture::new(); put(&f.workspace.join("notes/build/important.txt"), &[1; 43]);
    put(&f.workspace.join("notes/node_modules/important.txt"), &[1; 17]);
    let r = f.scan(); assert!(r.findings.is_empty()); assert_eq!(r.progress.logical_bytes, 60);
}
#[test]
fn maven_repository_is_protected_even_with_remote_metadata() {
    let f = Fixture::new(); put(&f.home.join(".m2/repository/private/local/1/local.jar"), &[2; 777]);
    put(&f.home.join(".m2/repository/private/local/1/_remote.repositories"), b"local.jar>=");
    let r = f.scan(); assert_eq!(of_kind(&r, "maven-repository").risk, "protected");
}
#[test]
fn wrapper_matching_is_limited_to_discovered_projects() {
    let f = Fixture::new(); let root = f.workspace.join("service");
    put(&root.join("build.gradle.kts"), b"// marker only");
    put(&root.join("gradle/wrapper/gradle-wrapper.properties"), b"distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip");
    put(&f.home.join(".gradle/wrapper/dists/gradle-8.14.3-bin/hash/gradle.zip"), &[1; 20]);
    put(&f.home.join(".gradle/wrapper/dists/gradle-7.6.4-bin/hash/gradle.zip"), &[1; 30]);
    let r = f.scan(); assert_eq!(r.projects[0].wrapper_version.as_deref(), Some("8.14.3"));
    let matched = r.findings.iter().find(|f| f.wrapper_version.as_deref() == Some("8.14.3")).unwrap(); assert_eq!(matched.wrapper_references.len(), 1);
    let other = r.findings.iter().find(|f| f.wrapper_version.as_deref() == Some("7.6.4")).unwrap(); assert!(other.wrapper_references.is_empty()); assert_eq!(other.risk, "review");
}
#[test]
fn overlapping_roots_are_not_double_counted() {
    let f = Fixture::new(); let root = f.workspace.join("web"); put(&root.join("package.json"), b"{}"); put(&root.join("node_modules/x/data"), &[1; 19]);
    let r = scan_with_environment(ScanRequest { roots: vec![f.workspace.to_string_lossy().into_owned(), root.to_string_lossy().into_owned(), f.workspace.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] }, &f.env(), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(r.roots.len(), 1); assert_eq!(r.progress.logical_bytes, 21); assert_eq!(r.findings.len(), 1);
}
#[test]
fn cache_inside_selected_root_is_counted_once() {
    let f = Fixture::new(); put(&f.home.join(".m2/repository/local.jar"), &[1; 71]);
    let r = scan_with_environment(ScanRequest { roots: vec![f.home.to_string_lossy().into_owned()], ..ScanRequest::default() }, &f.env(), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(r.progress.logical_bytes, 71); assert_eq!(r.roots.len(), 1); assert_eq!(r.findings.len(), 1);
}
#[test]
fn nested_projects_have_exclusive_byte_ownership() {
    let f = Fixture::new(); put(&f.workspace.join("mono/package.json"), b"{}"); put(&f.workspace.join("mono/packages/app/package.json"), b"{}"); put(&f.workspace.join("mono/packages/app/node_modules/x"), &[1; 50]);
    let r = f.scan(); assert_eq!(r.projects.len(), 2); assert_eq!(r.projects.iter().map(|p| p.owned_logical_bytes).sum::<u64>(), r.progress.logical_bytes); assert_eq!(r.progress.logical_bytes, 54);
}
#[test]
fn worktree_pointer_is_not_followed() {
    let f = Fixture::new(); put(&f.workspace.join("wt/.git"), b"gitdir: ../../outside/private");
    let r = f.scan(); assert_eq!(r.projects.len(), 1); assert_eq!(r.projects[0].git_kind.as_deref(), Some("worktree")); assert!(r.projects[0].branch.is_none()); assert_eq!(of_kind(&r, "git-metadata").risk, "protected");
}
#[test]
fn valid_virtual_environment_still_requires_review() {
    let f = Fixture::new(); put(&f.workspace.join("python/pyproject.toml"), b"[project]"); put(&f.workspace.join("python/uv.lock"), b"version = 1"); put(&f.workspace.join("python/.venv/pyvenv.cfg"), b"home = local");
    let r = f.scan(); assert_eq!(of_kind(&r, "python-venv").risk, "review");
}
#[test]
fn unrecognized_venv_is_protected() {
    let f = Fixture::new(); put(&f.workspace.join("python/pyproject.toml"), b"[project]"); put(&f.workspace.join("python/.venv/important.txt"), b"unique");
    let r = f.scan(); assert_eq!(of_kind(&r, "python-venv").risk, "protected");
}
#[test]
fn bytecode_without_corresponding_source_is_protected() {
    let f = Fixture::new(); put(&f.workspace.join("python/pyproject.toml"), b"[project]"); put(&f.workspace.join("python/__pycache__/module.cpython-313.pyc"), &[1; 10]);
    let r = f.scan(); assert_eq!(of_kind(&r, "python-bytecode").risk, "protected");
    put(&f.workspace.join("python/module.py"), b"print('source')");
    let r = f.scan(); assert_eq!(of_kind(&r, "python-bytecode").risk, "low");
}
#[test]
fn extra_files_in_bytecode_cache_prevent_low_risk_classification() {
    let f = Fixture::new(); put(&f.workspace.join("python/pyproject.toml"), b"[project]"); put(&f.workspace.join("python/module.py"), b"source"); put(&f.workspace.join("python/__pycache__/module.cpython-313.pyc"), &[1; 10]); put(&f.workspace.join("python/__pycache__/notes.txt"), b"do not lose");
    assert_eq!(of_kind(&f.scan(), "python-bytecode").risk, "protected");
}
#[test]
fn personal_protection_covers_a_child_inside_an_aggregate() {
    let f = Fixture::new(); let root = f.workspace.join("web"); put(&root.join("package.json"), b"{}"); put(&root.join("node_modules/local/index.js"), b"patched");
    let r = scan_with_environment(ScanRequest { roots: vec![f.workspace.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![root.join("node_modules/local").to_string_lossy().into_owned()] }, &f.env(), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(of_kind(&r, "node-modules").user_protected);
}
#[test]
fn pre_cancelled_scan_returns_explicit_partial_result() {
    let f = Fixture::new(); put(&f.workspace.join("file"), b"abc");
    let cancelled = AtomicBool::new(true);
    let r = scan_with_environment(ScanRequest { roots: vec![f.workspace.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] }, &f.env(), &cancelled, |_| {}).unwrap();
    assert!(r.cancelled); assert!(!r.complete); assert_eq!(r.progress.files, 0);
}
#[test]
fn hardlinks_are_logical_bytes_not_promised_savings() {
    let f = Fixture::new(); put(&f.workspace.join("first"), &[3; 17]); fs::hard_link(f.workspace.join("first"), f.workspace.join("second")).unwrap();
    let r = f.scan(); assert_eq!(r.progress.logical_bytes, 34); assert!(r.size_basis.contains("not physical"));
}
#[test]
fn npm_configuration_is_read_selectively_without_exposing_secrets() {
    let f = Fixture::new(); let cache = f.temp.path().join("custom-npm"); put(&cache.join("_cacache/data"), &[1; 60]);
    put(&f.home.join(".npmrc"), format!("//registry.example/:_authToken=PRIVATE_CANARY\ncache={}\n", cache.display()).as_bytes());
    let locations = discover(&f.env()); assert!(locations.iter().any(|c| c.kind == "npm-cache" && c.source.contains("npm configuration")));
    let text = serde_json::to_string(&f.scan()).unwrap(); assert!(!text.contains("PRIVATE_CANARY"));
}
#[test]
fn maven_settings_honor_real_elements_not_comments() {
    let f = Fixture::new(); let repo = f.temp.path().join("custom-maven"); put(&repo.join("local.jar"), &[1; 99]);
    put(&f.home.join(".m2/settings.xml"), format!("<settings><!-- <localRepository>/wrong</localRepository> --><localRepository>{}</localRepository></settings>", repo.display()).as_bytes());
    assert_eq!(of_kind(&f.scan(), "maven-repository").logical_bytes, 99);
}
#[test]
fn build_scripts_and_source_contents_are_not_executed_or_exported() {
    let f = Fixture::new(); let root = f.workspace.join("service");
    put(&root.join("build.gradle"), b"throw new RuntimeException('PRIVATE_CANARY')"); put(&root.join(".env"), b"PASSWORD=PRIVATE_CANARY"); put(&root.join("src/Binary.java"), &[255, 254, 0, 1]); put(&root.join("build/result"), &[1; 100]);
    let before = fs::read(root.join("build/result")).unwrap(); let modified = fs::metadata(root.join("build/result")).unwrap().modified().unwrap();
    let r = f.scan(); assert!(!serde_json::to_string(&r).unwrap().contains("PRIVATE_CANARY"));
    assert_eq!(before, fs::read(root.join("build/result")).unwrap()); assert_eq!(modified, fs::metadata(root.join("build/result")).unwrap().modified().unwrap()); assert!(r.complete);
}
#[test]
fn virtual_disks_are_never_cleanup_candidates() {
    let f = Fixture::new(); put(&f.workspace.join("ext4.vhdx"), &[1; 42]); assert_eq!(of_kind(&f.scan(), "virtual-disk").risk, "protected");
}
#[test]
fn missing_and_relative_roots_are_rejected() {
    let f = Fixture::new();
    for path in ["relative".to_string(), f.temp.path().join("missing").to_string_lossy().into_owned()] {
        assert!(scan_with_environment(ScanRequest { roots: vec![path], include_global_caches: false, protected_paths: vec![] }, &f.env(), &AtomicBool::new(false), |_| {}).is_err());
    }
}
#[cfg(unix)]
#[test]
fn symlink_loop_and_explicit_symlink_root_are_not_followed() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new(); put(&f.workspace.join("web/package.json"), b"{}"); put(&f.workspace.join("web/node_modules/file"), &[1; 40]);
    symlink(&f.workspace, f.workspace.join("web/node_modules/loop")).unwrap();
    let r = f.scan(); assert_eq!(r.progress.logical_bytes, 42); assert!(!r.complete); assert!(r.warnings.iter().any(|w| w.code == "link-skipped"));
    symlink(&f.workspace, f.temp.path().join("alias")).unwrap();
    assert!(scan_with_environment(ScanRequest { roots: vec![f.temp.path().join("alias").to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] }, &f.env(), &AtomicBool::new(false), |_| {}).is_err());
}
#[cfg(unix)]
#[test]
fn linked_manifest_is_not_read() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new(); let external = f.temp.path().join("external.json"); put(&external, br#"{"secret":"PRIVATE_CANARY"}"#);
    fs::create_dir_all(f.workspace.join("fake")).unwrap(); symlink(external, f.workspace.join("fake/package.json")).unwrap();
    let r = f.scan(); assert!(r.projects.is_empty()); assert!(!serde_json::to_string(&r).unwrap().contains("PRIVATE_CANARY"));
}
#[cfg(windows)]
#[test]
fn windows_junction_is_not_followed() {
    let f = Fixture::new(); let target = f.temp.path().join("outside"); put(&target.join("unique.txt"), &[1; 100]);
    let junction = f.workspace.join("junction");
    let status = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&junction).arg(&target).status().unwrap(); assert!(status.success());
    let r = f.scan(); assert_eq!(r.progress.logical_bytes, 0); assert!(r.warnings.iter().any(|w| w.code == "link-skipped"));
    fs::remove_dir(&junction).unwrap();
}
#[test]
fn final_progress_matches_result_and_cancellation_flag_is_shared() {
    let f = Fixture::new(); put(&f.workspace.join("file"), &[1; 10]);
    let cancelled = AtomicBool::new(false); let mut last = Progress::default();
    let r = scan_with_environment(ScanRequest { roots: vec![f.workspace.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] }, &f.env(), &cancelled, |p| last = p).unwrap();
    assert_eq!(last.files, r.progress.files); assert_eq!(last.logical_bytes, 10); cancelled.store(true, Ordering::Relaxed); assert!(cancelled.load(Ordering::Relaxed));
}
