//! Review-only regression tests against the unchanged 0.1.0 pilot.
//! Expectations describe the required behavior; failures are intentionally visible.
//! All filesystem fixtures live under a uniquely created temporary directory.
use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::atomic::AtomicBool};
use devspace_core::{config::{discover, Environment}, model::{Report, ScanRequest}, scan_with_environment};
use tempfile::TempDir;

struct Fixture { _temp: TempDir, home: PathBuf, workspace: PathBuf }
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        Self { _temp: temp, home, workspace }
    }
    fn env(&self) -> Environment {
        Environment { home: self.home.clone(), vars: HashMap::new(), platform: std::env::consts::OS.into() }
    }
    fn scan(&self, roots: Vec<PathBuf>, include_caches: bool, env: &Environment) -> Report {
        let request = ScanRequest { roots: roots.iter().map(|p| p.to_string_lossy().into_owned()).collect(), include_global_caches: include_caches, protected_paths: vec![] };
        let report = scan_with_environment(request, env, &AtomicBool::new(false), |_| {}).unwrap();
        println!("OBSERVED {}", serde_json::json!({
            "projects": report.projects.iter().map(|p| serde_json::json!({"path":p.path,"ecosystems":p.ecosystems})).collect::<Vec<_>>(),
            "findings": report.findings.iter().map(|f| serde_json::json!({"path":f.path,"kind":f.kind,"risk":f.risk,"bytes":f.logical_bytes,"complete":f.complete})).collect::<Vec<_>>(),
            "bytes":report.progress.logical_bytes,"warnings":report.warning_count,"complete":report.complete
        }));
        report
    }
}
fn put(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}
fn candidate_covers(report: &Report, path: &Path) -> bool {
    let path = fs::canonicalize(path).unwrap();
    report.findings.iter().any(|f| f.risk != "protected" && f.complete && !f.user_protected && path.starts_with(Path::new(&f.path)))
}

#[test]
fn r01_virtual_disk_inside_build_output_must_remain_protected() {
    let f = Fixture::new();
    put(&f.workspace.join("app/package.json"), b"{}");
    let disk = f.workspace.join("app/build/persistent.vhdx");
    put(&disk, &[1; 4096]);
    let r = f.scan(vec![f.workspace.clone()], false, &f.env());
    assert!(!candidate_covers(&r, &disk), "A protected VHDX was swallowed by an unprotected parent build finding");
}

#[test]
fn r01_git_repository_inside_build_directory_must_not_be_a_cleanup_candidate() {
    let f = Fixture::new();
    put(&f.workspace.join("app/package.json"), b"{}");
    let nested = f.workspace.join("app/build/tools");
    put(&nested.join(".git/HEAD"), b"ref: refs/heads/main\n");
    put(&nested.join("package.json"), b"{}");
    put(&nested.join("src/unique.js"), b"unique source");
    let r = f.scan(vec![f.workspace.clone()], false, &f.env());
    assert!(!candidate_covers(&r, &nested.join(".git/HEAD")), "Nested Git metadata is included in the parent's review-candidate bytes");
    assert_eq!(r.projects.len(), 2, "The nested source repository disappeared from project discovery");
}

#[test]
fn r01_configured_maven_repository_inside_other_cache_must_remain_protected() {
    let f = Fixture::new();
    let pip = f.home.join("shared-python-cache");
    let maven = pip.join("local-maven");
    put(&maven.join("private.jar"), &[2; 128]);
    put(&f.home.join(".m2/settings.xml"), format!("<settings><localRepository>{}</localRepository></settings>", maven.display()).as_bytes());
    let mut env = f.env();
    env.vars.insert("PIP_CACHE_DIR".into(), pip.to_string_lossy().into_owned());
    let r = f.scan(vec![f.workspace.clone()], true, &env);
    assert!(!candidate_covers(&r, &maven.join("private.jar")), "The explicitly configured protected Maven repository was swallowed by the parent pip cache");
}

#[test]
fn r02_explicit_maven_root_must_still_be_classified_when_auto_inclusion_is_off() {
    let f = Fixture::new();
    let repo = f.home.join(".m2/repository");
    put(&repo.join("local-only.jar"), &[1; 99]);
    let r = f.scan(vec![repo], false, &f.env());
    assert_eq!(r.progress.logical_bytes, 99);
    assert!(r.findings.iter().any(|x| x.kind == "maven-repository" && x.risk == "protected"), "The explicitly selected Maven storage was measured but not recognized");
}

#[test]
fn r02_explicit_gradle_cache_must_not_be_classified_as_project_artifacts() {
    let f = Fixture::new();
    let cache = f.home.join(".gradle/caches");
    put(&cache.join("8.14.3/generated-gradle-jars/gradle-api.jar"), &[1; 57]);
    let r = f.scan(vec![cache], false, &f.env());
    assert!(r.findings.iter().any(|x| x.kind == "gradle-cache"), "Explicitly selected Gradle cache is missing from classified developer storage");
}

#[test]
fn r03_npm_duplicate_scalar_settings_must_use_the_last_value() {
    let f = Fixture::new();
    let old = f.home.join("old-cache"); let current = f.home.join("current-cache");
    put(&old.join("_cacache/item"), &[1; 10]);
    put(&current.join("_cacache/item"), &[2; 20]);
    put(&f.home.join(".npmrc"), format!("cache={}\ncache={}\n", old.display(), current.display()).as_bytes());
    let caches = discover(&f.env());
    let selected = caches.iter().find(|x| x.kind == "npm-cache").unwrap();
    println!("OBSERVED selected npm cache: {}", selected.path);
    assert_eq!(PathBuf::from(&selected.path), fs::canonicalize(current).unwrap(), "Unlike npm's INI parser, the scanner selected the first cache setting");
}

#[test]
fn r03_npm_inline_comment_must_not_be_part_of_the_path() {
    let f = Fixture::new();
    let cache = f.home.join("npm-custom-cache");
    put(&cache.join("_cacache/item"), &[1; 32]);
    put(&f.home.join(".npmrc"), format!("cache={} ; developer cache\n", cache.display()).as_bytes());
    let caches = discover(&f.env());
    println!("OBSERVED locations: {caches:?}");
    assert!(caches.iter().any(|x| x.kind == "npm-cache" && PathBuf::from(&x.path) == fs::canonicalize(&cache).unwrap()), "A valid npm cache setting was silently omitted because of its inline comment");
}

#[cfg(unix)]
#[test]
fn r03_uppercase_npm_environment_override_must_work_on_unix() {
    let f = Fixture::new();
    let cache = f.home.join("npm-custom-cache");
    put(&cache.join("_cacache/item"), &[1; 32]);
    let mut env = f.env(); env.vars.insert("NPM_CONFIG_CACHE".into(), cache.to_string_lossy().into_owned());
    let caches = discover(&env);
    println!("OBSERVED locations: {caches:?}");
    assert!(caches.iter().any(|x| x.kind == "npm-cache" && PathBuf::from(&x.path) == fs::canonicalize(&cache).unwrap()), "npm environment configuration names are case-insensitive on Unix too");
}

#[test]
fn r04_uv_macos_default_is_dot_cache_not_library_caches() {
    let f = Fixture::new();
    let actual = f.home.join(".cache/uv");
    put(&actual.join("archive-v0/item"), &[1; 42]);
    let mut env = f.env(); env.platform = "macos".into();
    let caches = discover(&env);
    println!("OBSERVED locations with simulated macOS settings: {caches:?}");
    assert!(caches.iter().any(|x| x.kind == "uv-cache" && PathBuf::from(&x.path) == fs::canonicalize(&actual).unwrap()), "uv uses ~/.cache/uv on macOS unless overridden");
}

#[cfg(unix)]
#[test]
fn r05_wrapper_marker_must_not_be_detected_through_a_linked_ancestor() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let external = f.home.join("outside-gradle");
    put(&external.join("wrapper/gradle-wrapper.properties"), b"distributionUrl=https\\://example.invalid/gradle-8.14.3-bin.zip\n");
    let project = f.workspace.join("ordinary-folder");
    fs::create_dir_all(&project).unwrap();
    symlink(external, project.join("gradle")).unwrap();
    put(&project.join("build/unique.txt"), b"not a build output");
    let r = f.scan(vec![f.workspace.clone()], false, &f.env());
    assert!(r.projects.is_empty(), "A wrapper outside the no-follow scan boundary created a phantom Gradle project");
    assert!(r.findings.is_empty(), "Ordinary data acquired a build-artifact recommendation from an external marker");
}

#[test]
fn control_plain_project_and_standalone_disk_are_measured_without_writes() {
    let f = Fixture::new();
    put(&f.workspace.join("app/package.json"), b"{}");
    let output = f.workspace.join("app/node_modules/example/index.js");
    put(&output, &[1; 512]);
    let disk = f.workspace.join("persistent.vhdx");
    put(&disk, &[2; 128]);
    let before = fs::read(&output).unwrap(); let modified = fs::metadata(&output).unwrap().modified().unwrap();
    let r = f.scan(vec![f.workspace.clone()], false, &f.env());
    assert_eq!(r.projects.len(), 1); assert_eq!(r.progress.logical_bytes, 642);
    assert!(r.findings.iter().any(|x| x.kind == "node-modules" && x.logical_bytes == 512));
    assert!(!candidate_covers(&r, &disk));
    assert_eq!(fs::read(&output).unwrap(), before);
    assert_eq!(fs::metadata(&output).unwrap().modified().unwrap(), modified);
    assert!(r.complete);
}

#[test]
fn control_auto_included_maven_repository_is_protected() {
    let f = Fixture::new();
    let repo = f.home.join(".m2/repository");
    put(&repo.join("local-only.jar"), &[1; 99]);
    let r = f.scan(vec![f.workspace.clone()], true, &f.env());
    assert!(r.findings.iter().any(|x| x.kind == "maven-repository" && x.risk == "protected"));
}
