use std::{collections::HashMap, fs, path::Path, sync::atomic::{AtomicBool, Ordering}};
use devspace_core::{config::Environment, model::{Report, ScanRequest}, scan_with_environment};
fn put(path: &Path, contents: &[u8]) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, contents).unwrap(); }
fn scan(root: &Path, cancelled: &AtomicBool) -> Report {
    scan_with_environment(ScanRequest { roots: vec![root.to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] }, &Environment { home: root.join("home"), vars: HashMap::new(), platform: std::env::consts::OS.into() }, cancelled, |_| {}).unwrap()
}
#[test]
fn hierarchy_accounts_for_aggregates_unclassified_files_and_large_samples_without_writes() {
    let t = tempfile::tempdir().unwrap(); let root = t.path();
    put(&root.join("build.gradle"), b"// fixture"); put(&root.join("gradlew"), b"NEVER EXECUTE");
    put(&root.join("build/classes/output"), &[1; 100]); put(&root.join("logs/run.log"), &[2; 70]);
    put(&root.join("disk.vhdx"), &[3; 30]);
    let report = scan(root, &AtomicBool::new(false));
    let dirs = &report.storage.directories;
    let top = &dirs[0];
    assert_eq!(report.schema_version, 2);
    assert_eq!(top.logical_bytes, report.progress.logical_bytes);
    assert_eq!(top.classified_bytes, report.findings.iter().map(|f| f.logical_bytes).sum::<u64>());
    assert_eq!(top.direct_classified_bytes, 30);
    for node in dirs {
        let child_bytes: u64 = dirs.iter().filter(|d| d.parent_id == Some(node.id)).map(|d| d.logical_bytes).sum();
        assert_eq!(node.logical_bytes, child_bytes + node.direct_file_bytes);
        assert!(node.complete);
    }
    let logs = dirs.iter().find(|d| d.path.ends_with("logs")).unwrap();
    assert_eq!(logs.classified_bytes, 0); assert_eq!(logs.largest_files[0].name, "run.log");
    let classes = dirs.iter().find(|d| d.path.ends_with("classes")).unwrap();
    assert_eq!(classes.classified_bytes, 100);
    assert_eq!(fs::read(root.join("gradlew")).unwrap(), b"NEVER EXECUTE");
    assert_eq!(fs::read(root.join("logs/run.log")).unwrap(), vec![2; 70]);
    assert!(report.projects[0].recovery_evidence.as_ref().unwrap().wrappers.contains(&"gradlew".into()));
}
#[test]
fn node_evidence_reports_recovery_obstacles_without_retaining_script_contents_or_urls() {
    let t = tempfile::tempdir().unwrap();
    put(&t.path().join("package.json"), br#"{"packageManager":"npm@11","scripts":{"build":"SECRET DO NOT RUN", "postinstall":"NEVER RUN"},"dependencies":{"local-kit":"file:../private", "remote-kit":"https://user:secret@example.test/pkg.tgz"}}"#);
    put(&t.path().join("patches/fix.patch"), b"private patch");
    put(&t.path().join("node_modules/pkg/data"), &[1; 20]);
    let report = scan(t.path(), &AtomicBool::new(false));
    let evidence = report.projects[0].recovery_evidence.as_ref().unwrap();
    assert_eq!(evidence.node_manifest, "parsed"); assert_eq!(evidence.local_dependency_count, 2);
    assert!(evidence.install_scripts && evidence.patches);
    let serialized = serde_json::to_string(evidence).unwrap();
    assert!(!serialized.contains("SECRET")); assert!(!serialized.contains("secret@example")); assert!(!serialized.contains("../private"));
}
#[test]
fn malformed_manifest_is_unknown_not_proof_of_recovery() {
    let t = tempfile::tempdir().unwrap(); put(&t.path().join("package.json"), b"invalid");
    let report = scan(t.path(), &AtomicBool::new(false));
    assert_eq!(report.projects[0].recovery_evidence.as_ref().unwrap().node_manifest, "invalid");
}
#[test]
fn retained_file_samples_are_the_largest_and_totals_include_the_rest() {
    let t = tempfile::tempdir().unwrap();
    for i in 1..=12 { put(&t.path().join(format!("file-{i}")), &vec![0; i]); }
    let report = scan(t.path(), &AtomicBool::new(false)); let root = &report.storage.directories[0];
    assert_eq!(root.direct_files, 12); assert_eq!(root.direct_file_bytes, 78);
    assert_eq!(root.largest_files.iter().map(|f| f.logical_bytes).collect::<Vec<_>>(), vec![12, 11, 10, 9, 8]);
}
#[test]
fn directory_retention_limit_keeps_totals_and_never_creates_orphans() {
    let t = tempfile::tempdir().unwrap();
    for i in 0..10_010 { fs::create_dir(t.path().join(format!("folder-{i}"))).unwrap(); }
    put(&t.path().join("last-file"), &[0; 71]);
    let report = scan(t.path(), &AtomicBool::new(false));
    assert!(report.storage.truncated); assert!(report.complete);
    assert_eq!(report.progress.logical_bytes, 71); assert!(report.storage.directories.len() <= 10_000);
    assert_eq!(report.storage.directories.iter().filter(|d| d.parent_id.is_none()).count(), 1);
    assert_eq!(report.storage.directories[0].omitted_directories, 10_011 - report.storage.directories.len() as u64);
}
#[test]
fn cancelled_inventory_is_never_reported_as_complete() {
    let t = tempfile::tempdir().unwrap(); for i in 0..50 { put(&t.path().join(format!("folder-{i}/data")), &[0; 100]); }
    let cancelled = AtomicBool::new(true);
    let report = scan_with_environment(ScanRequest { roots: vec![t.path().to_string_lossy().into()], include_global_caches: false, protected_paths: vec![] }, &Environment { home: t.path().join("home"), vars: HashMap::new(), platform: "linux".into() }, &cancelled, |_| { cancelled.store(true, Ordering::Relaxed); }).unwrap();
    assert!(report.cancelled); assert!(!report.complete);
    assert!(report.storage.directories.is_empty());
}
