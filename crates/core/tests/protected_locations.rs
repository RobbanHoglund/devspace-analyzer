use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::ScanRequest, scan_with_environment};
fn put(path: &Path, bytes: &[u8]) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, bytes).unwrap(); }

#[test]
fn protected_locations_are_bounded_actionable_and_do_not_duplicate_measurements() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("package.json"), b"{}");
    for i in 0..30 { put(&t.path().join(format!("build/vendor-{i:02}/.yarn/patches/private.patch")), &[1; 10]); }
    // A nested guard under a listed protected parent is covered by that parent.
    put(&t.path().join("build/vendor-00/.yarn/persistent.vhdx"), &[2; 5]);
    let r = scan_with_environment(ScanRequest { roots: vec![t.path().to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home: t.path().into(), vars: HashMap::new(), platform: std::env::consts::OS.into() }, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(r.findings.len(), 1);
    let f = &r.findings[0];
    assert_eq!(f.risk, "protected");
    assert_eq!(f.protected_descendant_count, 30);
    assert_eq!(f.protected_descendants.len(), 20);
    assert!(f.protected_descendants[0].path.ends_with(if cfg!(windows) { "vendor-00\\.yarn" } else { "vendor-00/.yarn" }));
    for location in &f.protected_descendants { assert!(Path::new(&location.path).is_dir()); assert_eq!(location.label, "Project Yarn storage"); }
    assert_eq!(f.logical_bytes, 305); assert_eq!(r.progress.logical_bytes, 307);
    assert_eq!(r.projects[0].owned_logical_bytes, 307);
    assert!(f.evidence.iter().any(|s| s.contains("Virtual disk image")), "Keep category evidence even for covered nested guards");
}

#[test]
fn explicit_nested_git_project_reports_the_project_boundary_once() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("package.json"), b"{}");
    put(&t.path().join("build/tools/.git/HEAD"), b"ref: refs/heads/main");
    let r = scan_with_environment(ScanRequest { roots: vec![t.path().to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home: t.path().into(), vars: HashMap::new(), platform: std::env::consts::OS.into() }, &AtomicBool::new(false), |_| {}).unwrap();
    let f = &r.findings[0];
    assert_eq!(f.protected_descendant_count, 1);
    assert_eq!(f.protected_descendants[0].label, "Nested Git project");
    assert!(f.protected_descendants[0].path.ends_with("tools"));
}
