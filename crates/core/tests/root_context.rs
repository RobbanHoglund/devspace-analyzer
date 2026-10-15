use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::{Report, ScanRequest}, scan_with_environment};

fn put(path: &Path, data: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, data).unwrap();
}
fn scan(roots: &[&Path], home: &Path) -> Report {
    scan_with_environment(
        ScanRequest { roots: roots.iter().map(|p| p.to_string_lossy().into()).collect(), include_global_caches: false, protected_paths: vec![] },
        &Environment { home: home.into(), vars: HashMap::new(), platform: std::env::consts::OS.into() },
        &AtomicBool::new(false), |_| {},
    ).unwrap()
}

#[test]
fn selected_descendants_retain_intrinsic_storage_protection() {
    for boundary in [".yarn", ".git", ".venv", "venv", "__pycache__", ".gradle/caches/unknown-storage"] {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join(boundary);
        let selected = root.join("unplugged");
        put(&selected.join("pkg/package.json"), b"{}");
        put(&selected.join("pkg/dist/unique.js"), b"unique");
        put(&root.join("outside-scope.bin"), &[0; 200]);
        let broad = scan(&[&root], t.path());
        assert!(broad.findings.iter().all(|f| f.risk == "protected"));
        let narrow = scan(&[&selected], t.path());
        assert_eq!(narrow.findings.len(), 1, "{boundary}");
        let finding = &narrow.findings[0];
        assert_eq!(finding.risk, "protected", "{boundary}");
        assert_eq!(finding.path, fs::canonicalize(&selected).unwrap().to_string_lossy());
        assert_eq!(finding.logical_bytes, 8);
        assert_eq!(narrow.progress.logical_bytes, 8, "Do not measure siblings");
        assert!(finding.evidence.iter().any(|s| s.contains("Protection inherited")));
        assert!(narrow.complete);
    }
}

#[test]
fn selecting_a_child_cannot_bypass_excluded_ancestors() {
    let t = tempfile::tempdir().unwrap();
    let selected = t.path().join(".ssh/tool");
    put(&selected.join("package.json"), b"{}");
    put(&selected.join("dist/private"), b"private");
    let r = scan(&[&selected], t.path());
    assert_eq!(r.progress.files, 0);
    assert!(r.findings.is_empty());
    assert!(r.warnings.iter().any(|w| w.code == "policy-excluded"));
}

#[test]
fn similar_names_do_not_inherit_protection() {
    let t = tempfile::tempdir().unwrap();
    let selected = t.path().join(".yarn-backup/tool");
    put(&selected.join("package.json"), b"{}");
    put(&selected.join("dist/output"), b"output");
    let r = scan(&[&selected], t.path());
    assert_eq!(r.findings[0].risk, "review");
}

#[test]
fn direct_artifact_roots_and_deeper_subtrees_retain_project_context() {
    for (marker, output, kind) in [("package.json", "node_modules", "node-modules"), ("build.gradle", "build", "gradle-project"), ("pom.xml", "target", "maven-output"), ("pyproject.toml", ".venv", "python-venv")] {
        let t = tempfile::tempdir().unwrap();
        let app = t.path().join("app");
        put(&app.join(marker), b"{}");
        put(&app.join("unselected-source.txt"), &[0; 300]);
        let storage = app.join(output);
        if output == ".venv" { put(&storage.join("pyvenv.cfg"), b"home = fixture"); }
        if output == "node_modules" { put(&storage.join("pkg/package.json"), b"{}"); }
        put(&storage.join("pkg/content"), b"content");
        let broad = scan(&[&app], t.path());
        let direct = scan(&[&storage], t.path());
        assert_eq!(direct.findings.len(), 1, "{output}");
        assert_eq!(direct.findings[0].kind, kind);
        assert_eq!(direct.findings[0].logical_bytes, broad.findings[0].logical_bytes);
        assert_eq!(direct.projects.len(), 1, "Installed packages must not become projects");
        assert_eq!(direct.projects[0].name, "app");
        assert!(direct.projects[0].context_only);
        assert_eq!(direct.projects[0].owned_logical_bytes, direct.progress.logical_bytes);
        let narrow = scan(&[&storage.join("pkg")], t.path());
        assert_eq!(narrow.findings.len(), 1);
        assert_eq!(narrow.findings[0].kind, kind);
        assert_eq!(narrow.progress.logical_bytes, if output == "node_modules" { 9 } else { 7 });
        assert_eq!(narrow.projects[0].name, "app");
        assert_eq!(narrow.findings[0].project_id.as_deref(), Some(narrow.projects[0].id.as_str()));
        assert!(narrow.complete);
    }
}

#[test]
fn disjoint_artifact_roots_share_one_context_project_and_exclusive_bytes() {
    let t = tempfile::tempdir().unwrap();
    let app = t.path().join("app");
    put(&app.join("package.json"), b"{}");
    put(&app.join("build/out"), b"build");
    put(&app.join("node_modules/pkg/out"), b"installed");
    let r = scan(&[&app.join("build"), &app.join("node_modules/pkg")], t.path());
    assert_eq!(r.projects.len(), 1);
    assert_eq!(r.findings.len(), 2);
    assert_eq!(r.progress.logical_bytes, 14);
    assert_eq!(r.projects[0].owned_logical_bytes, 14);
    assert_eq!(r.projects[0].artifact_bytes, 14);
}

#[test]
fn a_selected_source_project_is_not_replaced_by_its_parent_context() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("package.json"), b"{}");
    let app = t.path().join("packages/app");
    put(&app.join("package.json"), b"{}");
    put(&app.join("dist/out"), b"out");
    let r = scan(&[&app], t.path());
    assert_eq!(r.projects.len(), 1);
    assert_eq!(r.projects[0].name, "app");
    assert!(!r.projects[0].context_only);
}

#[test]
fn selected_shared_cache_subtrees_do_not_invent_package_projects() {
    let t = tempfile::tempdir().unwrap();
    let selected = t.path().join(if cfg!(windows) { "AppData/Local/npm-cache/_npx/hash" } else { ".npm/_npx/hash" });
    put(&selected.join("package.json"), b"{}");
    put(&selected.join("node_modules/pkg/package.json"), b"{}");
    let r = scan(&[&selected], t.path());
    assert_eq!(r.findings.len(), 1);
    assert_eq!(r.findings[0].kind, "npm-cache");
    assert!(r.projects.is_empty());
}
