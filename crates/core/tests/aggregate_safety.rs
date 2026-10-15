use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::{Report, ScanRequest}, scan_with_environment};

fn put(path: &Path, data: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, data).unwrap();
}

fn scan(root: &Path, env: &Environment) -> Report {
    scan_with_environment(
        ScanRequest { roots: vec![root.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] },
        env, &AtomicBool::new(false), |_| {},
    ).unwrap()
}

#[test]
fn manifest_only_nested_projects_keep_protected_content_inside_aggregates() {
    for (marker, output) in [("package.json", "build"), ("build.gradle", "build"), ("pom.xml", "target"), ("pyproject.toml", ".venv")] {
        for (nested_marker, protected_file, kind) in [
            ("package.json", ".yarn/patches/local.patch", "yarn-project"),
            ("pyproject.toml", "__pycache__/lost.cpython-313.pyc", "python-bytecode"),
            ("pyproject.toml", ".venv/unique.txt", "python-venv"),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let home = temp.path().join("home");
            fs::create_dir(&home).unwrap();
            let root = temp.path().join("app");
            put(&root.join(marker), b"{}");
            if output == ".venv" { put(&root.join(output).join("pyvenv.cfg"), b"home = fixture"); }
            let nested = root.join(output).join("tool");
            put(&nested.join(nested_marker), b"{}");
            put(&nested.join(protected_file), b"unique data");
            let env = Environment { home, platform: std::env::consts::OS.into(), vars: HashMap::new() };

            let direct = scan(&nested, &env);
            assert!(direct.findings.iter().any(|f| f.kind == kind && f.risk == "protected"));
            let broad = scan(&root, &env);
            assert_eq!(broad.findings.len(), 1, "Keep a single accounting aggregate");
            assert_eq!(broad.findings[0].risk, "protected", "{marker}/{output}/{protected_file}");
            assert!(broad.findings[0].complete);
            assert_eq!(broad.projects.len(), 1, "Dependency manifests must not inflate project inventory");
            assert_eq!(broad.projects[0].owned_logical_bytes, broad.progress.logical_bytes);
            assert_eq!(broad.findings[0].logical_bytes + 2, broad.progress.logical_bytes);
        }
    }
}

#[test]
fn protected_content_is_checked_in_shared_caches_without_a_project_owner() {
    let temp = tempfile::tempdir().unwrap();
    let cache = temp.path().join("pip-cache");
    put(&cache.join("tool/package.json"), b"{}");
    put(&cache.join("tool/.yarn/patches/local.patch"), b"unique patch");
    let env = Environment {
        home: temp.path().to_path_buf(), platform: std::env::consts::OS.into(),
        vars: HashMap::from([("PIP_CACHE_DIR".into(), cache.to_string_lossy().into_owned())]),
    };
    let report = scan(&cache, &env);
    assert_eq!(report.findings.len(), 1);
    assert_eq!(report.findings[0].risk, "protected");
    assert!(report.projects.is_empty());
    assert_eq!(report.findings[0].logical_bytes, report.progress.logical_bytes);
}
