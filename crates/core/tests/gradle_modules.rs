use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::{Report, ScanRequest}, scan_with_environment};
fn put(path: &Path, data: &[u8]) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, data).unwrap(); }
fn scan(root: &Path, home: &Path) -> Report {
    scan_with_environment(ScanRequest { roots: vec![root.to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home: home.into(), vars: HashMap::new(), platform: std::env::consts::OS.into() }, &AtomicBool::new(false), |_| {}).unwrap()
}

#[test]
fn root_configured_modules_have_artifacts_and_exclusive_ownership() {
    for (settings, text) in [("settings.gradle", "include 'api', ':lib:core'"), ("settings.gradle.kts", "include(\"api\", \":lib:core\")")] {
        let t = tempfile::tempdir().unwrap(); let root = t.path().join("app");
        put(&root.join(settings), text.as_bytes());
        put(&root.join("build.gradle"), b"subprojects { apply plugin: 'java' }");
        put(&root.join("api/build/classes/out"), &[1; 20]);
        put(&root.join("lib/core/build/classes/out"), &[2; 30]);
        put(&root.join("not-declared/build/unique"), &[3; 40]);
        let r = scan(&root, t.path());
        assert!(r.complete);
        assert_eq!(r.projects.len(), 4, "Root, api, lib and core");
        assert_eq!(r.findings.len(), 2);
        assert_eq!(r.findings.iter().map(|f| f.logical_bytes).sum::<u64>(), 50);
        assert_eq!(r.projects.iter().map(|p| p.owned_logical_bytes).sum::<u64>(), r.progress.logical_bytes);
        for f in &r.findings { assert_eq!(f.risk, "review"); assert_eq!(f.kind, "gradle-project"); }
        let narrow = scan(&root.join("api/build"), t.path());
        assert_eq!(narrow.findings[0].logical_bytes, 20);
        assert_eq!(narrow.projects.len(), 1);
        assert_eq!(narrow.projects[0].name, "api");
        assert!(narrow.projects[0].context_only);
    }
}

#[test]
fn dynamic_and_remapped_modules_are_diagnosed_without_guessing() {
    for text in ["include(moduleName)", "include(':api')\nproject(':api').projectDir = file('../elsewhere')", "apply(from = 'modules.gradle')"] {
        let t = tempfile::tempdir().unwrap();
        put(&t.path().join("settings.gradle"), text.as_bytes());
        put(&t.path().join("api/build/unique"), b"unique");
        let r = scan(t.path(), t.path());
        assert!(r.findings.is_empty(), "{text}");
        assert!(r.warnings.iter().any(|w| w.code == "gradle-settings"), "{text}");
    }
}

#[test]
fn comment_and_string_examples_do_not_create_projects() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("settings.gradle"), b"// include 'api'\n/* include('api') */\nrootProject.name = \"include('api')\"");
    put(&t.path().join("api/build/unique"), b"unique");
    let r = scan(t.path(), t.path());
    assert!(r.complete); assert_eq!(r.projects.len(), 1); assert!(r.findings.is_empty());
}

#[test]
fn module_output_retains_protected_descendant_guards() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("settings.gradle.kts"), b"include(\"api\")");
    put(&t.path().join("api/build/private.vhdx"), b"private");
    let r = scan(t.path(), t.path());
    assert_eq!(r.findings.len(), 1); assert_eq!(r.findings[0].risk, "protected");
}

#[cfg(unix)]
#[test]
fn linked_module_directory_is_not_followed() {
    let t = tempfile::tempdir().unwrap(); let outside = tempfile::tempdir().unwrap();
    put(&t.path().join("settings.gradle"), b"include 'api'");
    put(&outside.path().join("build/private"), b"private");
    std::os::unix::fs::symlink(outside.path(), t.path().join("api")).unwrap();
    let r = scan(t.path(), t.path());
    assert!(r.findings.is_empty()); assert_eq!(r.projects.len(), 1);
    assert!(r.warnings.iter().any(|w| w.code == "link-skipped"));
}
