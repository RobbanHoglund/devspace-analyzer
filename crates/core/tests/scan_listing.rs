use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::ScanRequest, scan_with_environment};

fn put(path: &Path, data: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, data).unwrap();
}

#[test]
fn wide_listings_keep_project_markers_nested_git_and_exact_accounting() {
    let temp = tempfile::tempdir().unwrap();
    // macOS temp paths may start with /var, a symlink to /private/var. The
    // fixture must use the real path so it exercises listing, not link rejection.
    let home = temp.path().canonicalize().unwrap();
    let root = home.join("workspace");
    put(&root.join("package.json"), b"{}");
    // Both directories exceed the bounded name lookahead. Late markers must
    // still be recognized without retaining an entire directory in memory.
    for n in 0..400 {
        put(&root.join(format!("a-{n}.txt")), b"source");
        put(&root.join(format!("node_modules/nested/a-{n}.js")), b"dependency");
    }
    put(&root.join("node_modules/nested/.git/HEAD"), b"ref: refs/heads/main\n");
    let before = fs::metadata(root.join("package.json")).unwrap().modified().unwrap();
    let report = scan_with_environment(
        ScanRequest { roots: vec![root.to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home, platform: std::env::consts::OS.into(), vars: HashMap::new() },
        &AtomicBool::new(false), |_| {},
    ).unwrap();
    assert!(report.complete);
    assert_eq!(report.progress.files, 802);
    assert_eq!(report.progress.logical_bytes, 2 + 400 * 6 + 400 * 10 + 21);
    assert_eq!(report.projects.len(), 2);
    assert_eq!(report.projects.iter().map(|p| p.owned_logical_bytes).sum::<u64>(), report.progress.logical_bytes);
    assert_eq!(report.findings.len(), 1);
    assert_eq!(report.findings[0].risk, "protected");
    assert!(report.findings[0].protected_descendants.iter().any(|p| p.label == "Nested Git project"));
    assert_eq!(fs::metadata(root.join("package.json")).unwrap().modified().unwrap(), before);
}

#[test]
fn marker_hints_preserve_the_filesystems_case_sensitivity() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().canonicalize().unwrap();
    let root = home.join("workspace");
    put(&root.join("PACKAGE.JSON"), b"{}"); put(&root.join("node_modules/example/index.js"), b"fixture");
    let report = scan_with_environment(
        ScanRequest { roots: vec![root.to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home, platform: std::env::consts::OS.into(), vars: HashMap::new() },
        &AtomicBool::new(false), |_| {},
    ).unwrap();
    assert!(report.complete); assert_eq!(report.progress.files, 2);
    // Match the filesystem's own answer, including case-sensitive volumes on
    // platforms where the default is otherwise case-insensitive.
    if root.join("package.json").is_file() {
        assert_eq!(report.projects.len(), 1);
        assert_eq!(report.findings[0].kind, "node-modules");
    } else {
        assert!(report.projects.is_empty()); assert!(report.findings.is_empty());
    }
}

#[test]
fn pipenv_projects_retain_mixed_case_manifest_and_lockfile_markers() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().canonicalize().unwrap();
    let root = home.join("workspace");
    put(&root.join("pipenv/Pipfile"), b"[packages]\n");
    put(&root.join("pipenv/Pipfile.lock"), b"{}");
    let report = scan_with_environment(
        ScanRequest { roots: vec![root.to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home, platform: std::env::consts::OS.into(), vars: HashMap::new() },
        &AtomicBool::new(false), |_| {},
    ).unwrap();
    assert!(report.complete); assert_eq!(report.progress.files, 2);
    assert_eq!(report.projects.len(), 1);
    assert_eq!(report.projects[0].ecosystems, ["Python"]);
    assert_eq!(report.projects[0].markers, ["Pipfile"]);
    assert_eq!(report.projects[0].lockfiles, ["Pipfile.lock"]);
    assert_eq!(report.projects[0].owned_logical_bytes, report.progress.logical_bytes);
}
