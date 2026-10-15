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
