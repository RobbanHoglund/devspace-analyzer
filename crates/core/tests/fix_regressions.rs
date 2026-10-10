use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::atomic::AtomicBool};
use devspace_core::{config::{discover, discover_with_warnings, Environment}, model::{Report, ScanRequest}, scan_with_environment};
use tempfile::TempDir;

struct Fixture { _temp: TempDir, home: PathBuf, root: PathBuf }
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap(); let home = temp.path().join("home"); let root = temp.path().join("work");
        fs::create_dir_all(&home).unwrap(); fs::create_dir_all(&root).unwrap(); Self { _temp: temp, home, root }
    }
    fn env(&self) -> Environment { Environment { home: self.home.clone(), platform: std::env::consts::OS.into(), vars: HashMap::new() } }
    fn scan(&self, root: &Path, auto: bool, env: &Environment) -> Report {
        scan_with_environment(ScanRequest { roots: vec![root.to_string_lossy().into_owned()], include_global_caches: auto, protected_paths: vec![] }, env, &AtomicBool::new(false), |_| {}).unwrap()
    }
}
fn put(p: &Path, data: &[u8]) { fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, data).unwrap(); }
fn cache(env: &Environment, kind: &str) -> Option<PathBuf> { discover(env).into_iter().find(|c| c.kind == kind).map(|c| c.path.into()) }

#[test]
fn r01_protection_covers_all_supported_output_aggregates() {
    for (marker, output) in [("build.gradle", "build"), ("pom.xml", "target"), ("package.json", "node_modules"), ("pyproject.toml", ".venv")] {
        let f = Fixture::new(); put(&f.root.join(marker), b"{}");
        put(&f.root.join(output).join("ordinary.bin"), &[1; 33]);
        put(&f.root.join(output).join("nested/disk.VHDX"), &[2; 77]);
        let r = f.scan(&f.root, false, &f.env());
        let finding = r.findings.iter().find(|x| Path::new(&x.path).ends_with(output)).unwrap();
        assert_eq!(finding.risk, "protected", "{marker}/{output}");
        assert_eq!(finding.logical_bytes, 110); assert_eq!(r.progress.logical_bytes, 112);
        assert_eq!(r.findings.iter().map(|x| x.logical_bytes).sum::<u64>(), 110);
        assert!(finding.evidence.iter().any(|e| e.contains("Virtual disk")));
    }
}
#[test]
fn r01_nested_source_ownership_is_exclusive_and_evidence_is_preserved() {
    let f = Fixture::new(); put(&f.root.join("package.json"), b"{}");
    put(&f.root.join("build/out.bin"), &[1; 17]);
    let nested = f.root.join("build/tools");
    put(&nested.join(".git/HEAD"), b"ref: refs/heads/main\n");
    put(&nested.join("package.json"), b"{}"); put(&nested.join("source.js"), &[2; 31]);
    // A dependency manifest alone must not become a project during aggregation.
    put(&f.root.join("build/vendor/package.json"), b"{}");
    let r = f.scan(&f.root, false, &f.env());
    assert_eq!(r.projects.len(), 2);
    assert_eq!(r.projects.iter().map(|p| p.owned_logical_bytes).sum::<u64>(), r.progress.logical_bytes);
    let outer = r.projects.iter().find(|p| p.name == "work").unwrap();
    assert_eq!(outer.owned_logical_bytes, 21); assert_eq!(outer.artifact_bytes, 19);
    let inner = r.projects.iter().find(|p| p.name == "tools").unwrap();
    assert_eq!(inner.artifact_bytes, 0); assert!(inner.owned_logical_bytes > 31);
    assert_eq!(r.findings.len(), 1); assert_eq!(r.findings[0].risk, "protected");
    assert!(r.findings[0].evidence.iter().any(|s| s.contains("nested Git")));
}
#[test]
fn r01_same_path_cache_alias_cannot_downgrade_maven_protection() {
    let f = Fixture::new(); let storage = f.home.join("shared"); put(&storage.join("private.jar"), &[1; 79]);
    put(&f.home.join(".m2/settings.xml"), format!("<settings><localRepository>{}</localRepository></settings>", storage.display()).as_bytes());
    let mut env = f.env(); env.vars.insert("PIP_CACHE_DIR".into(), storage.to_string_lossy().into_owned());
    let r = f.scan(&storage, false, &env);
    assert_eq!(r.findings.len(), 1); assert_eq!(r.findings[0].risk, "protected");
    assert_eq!(r.findings[0].kind, "maven-repository"); assert_eq!(r.progress.logical_bytes, 79);
}
#[test]
fn r02_auto_off_never_measures_unrelated_known_caches() {
    let f = Fixture::new(); let maven = f.home.join(".m2/repository"); put(&maven.join("local.jar"), &[1; 99]);
    put(&f.home.join(".gradle/caches/8.14.3/other.bin"), &[2; 57]);
    let r = f.scan(&maven, false, &f.env());
    assert_eq!(r.progress.logical_bytes, 99); assert_eq!(r.roots.len(), 1);
    assert!(r.global_caches.iter().all(|c| c.kind == "maven-repository"));
    assert_eq!(r.findings[0].risk, "protected");
}
#[test]
fn r02_selected_subtree_of_protected_cache_is_still_protected() {
    let f = Fixture::new(); let selected = f.home.join(".m2/repository/local-only"); put(&selected.join("x.jar"), &[1; 13]);
    let r = f.scan(&selected, false, &f.env());
    assert_eq!(r.progress.logical_bytes, 13); assert_eq!(r.findings[0].risk, "protected");
}
#[test]
fn r03_quoted_and_escaped_cache_paths_resolve_without_leaking_credentials() {
    for quoted in [false, true] {
        let f = Fixture::new(); let target = f.home.join("Jane Doe cache;#"); put(&target.join("_cacache/data"), &[1; 11]);
        let text = if quoted { serde_json::to_string(&target.to_string_lossy()).unwrap() } else {
            target.to_string_lossy().replace('\\', "\\\\").replace(';', "\\;").replace('#', "\\#")
        };
        put(&f.home.join(".npmrc"), format!("//registry/:_authToken=PRIVATE_CANARY\ncache={text}\n").as_bytes());
        assert_eq!(cache(&f.env(), "npm-cache"), Some(fs::canonicalize(&target).unwrap()));
        let r = f.scan(&f.root, true, &f.env());
        assert!(!serde_json::to_string(&r).unwrap().contains("PRIVATE_CANARY"));
    }
}
#[test]
fn r03_invalid_override_reports_diagnostic_instead_of_default_fallback() {
    let f = Fixture::new(); put(&f.home.join(".npm/_cacache/default"), &[1; 4]);
    let mut env = f.env(); env.vars.insert("NPM_CONFIG_CACHE".into(), "relative-PRIVATE_CANARY".into());
    let result = discover_with_warnings(&env);
    assert!(!result.locations.iter().any(|c| c.kind == "npm-cache"));
    assert!(result.warnings.iter().any(|w| w.code == "cache-configuration"));
    assert!(!serde_json::to_string(&result.warnings).unwrap().contains("PRIVATE_CANARY"));
}
#[test]
fn r03_missing_explicit_cache_is_visible_as_a_coverage_warning() {
    let f = Fixture::new(); let mut env = f.env();
    env.vars.insert("npm_config_cache".into(), f.home.join("missing").to_string_lossy().into_owned());
    let r = f.scan(&f.root, true, &env);
    assert!(!r.complete); assert!(r.warnings.iter().any(|w| w.code == "cache-configuration"));
}
#[test]
fn r03_uppercase_userconfig_and_environment_precedence_work_on_all_hosts() {
    let f = Fixture::new(); let configured = f.home.join("configured"); let overridden = f.home.join("overridden");
    put(&configured.join("_cacache/a"), b"a"); put(&overridden.join("_cacache/b"), b"b");
    let npmrc = f.home.join("custom.npmrc"); put(&npmrc, format!("cache={}\n", configured.display()).as_bytes());
    let mut env = f.env(); env.vars.insert("NPM_CONFIG_USERCONFIG".into(), npmrc.to_string_lossy().into_owned());
    assert_eq!(cache(&env, "npm-cache"), Some(fs::canonicalize(&configured).unwrap()));
    env.vars.insert("NPM_CONFIG_CACHE".into(), overridden.to_string_lossy().into_owned());
    assert_eq!(cache(&env, "npm-cache"), Some(fs::canonicalize(&overridden).unwrap()));
}
#[test]
fn r04_uv_override_precedence_is_independent_of_pip_on_macos_and_linux() {
    for platform in ["macos", "linux"] {
        let f = Fixture::new(); let default = f.home.join(".cache/uv"); let xdg = f.home.join("xdg"); let explicit = f.home.join("uv-explicit");
        put(&default.join("x"), b"a"); put(&xdg.join("uv/x"), b"b"); put(&explicit.join("x"), b"c");
        let mut env = f.env(); env.platform = platform.into();
        assert_eq!(cache(&env, "uv-cache"), Some(fs::canonicalize(&default).unwrap()));
        env.vars.insert("XDG_CACHE_HOME".into(), xdg.to_string_lossy().into_owned());
        assert_eq!(cache(&env, "uv-cache"), Some(fs::canonicalize(xdg.join("uv")).unwrap()));
        env.vars.insert("UV_CACHE_DIR".into(), explicit.to_string_lossy().into_owned());
        assert_eq!(cache(&env, "uv-cache"), Some(fs::canonicalize(&explicit).unwrap()));
    }
}
#[cfg(windows)]
#[test]
fn r05_windows_junction_cannot_invent_a_gradle_project() {
    let f = Fixture::new(); let outside = f.home.join("external-gradle");
    put(&outside.join("wrapper/gradle-wrapper.properties"), b"distributionUrl=https\\://example.invalid/gradle-8.14.3-bin.zip");
    let link = f.root.join("gradle");
    let status = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).status().unwrap();
    assert!(status.success()); put(&f.root.join("build/unique.txt"), b"unique source");
    let r = f.scan(&f.root, false, &f.env());
    fs::remove_dir(&link).unwrap();
    assert!(r.projects.is_empty()); assert!(r.findings.is_empty());
    assert!(r.warnings.iter().any(|w| w.code == "link-skipped"));
}
