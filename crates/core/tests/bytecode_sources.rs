use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};
use devspace_core::{config::Environment, model::ScanRequest, scan_with_environment};

fn risk(bytecode: &str, sources: &[&str]) -> String {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::write(root.join("pyproject.toml"), b"[project]").unwrap();
    fs::create_dir(root.join("__pycache__")).unwrap();
    fs::write(root.join("__pycache__").join(bytecode), b"not read by scanner").unwrap();
    for source in sources { fs::write(root.join(source), b"not read by scanner").unwrap(); }
    let report = scan_with_environment(
        ScanRequest { roots: vec![root.to_string_lossy().into_owned()], include_global_caches: false, protected_paths: vec![] },
        &Environment { home: root.to_path_buf(), vars: HashMap::new(), platform: std::env::consts::OS.into() },
        &AtomicBool::new(false), |_| {},
    ).unwrap();
    report.findings.iter().find(|f| Path::new(&f.path).ends_with("__pycache__")).unwrap().risk.clone()
}

#[test]
fn dotted_source_stems_are_not_truncated_to_an_unrelated_source() {
    for bytecode in ["foo.bar.cpython-313.pyc", "foo.bar.cpython-313.opt-1.pyc", "foo.bar.pyc"] {
        assert_eq!(risk(bytecode, &["foo.py"]), "protected", "{bytecode}");
    }
}

#[test]
fn recognized_cpython_names_require_the_exact_source_stem() {
    for (bytecode, source) in [
        ("foo.cpython-313.pyc", "foo.py"),
        ("foo.cpython-313.opt-1.pyc", "foo.py"),
        ("foo.cpython-313.opt-2.pyc", "foo.py"),
        ("foo.cpython-314t.pyc", "foo.py"),
        ("foo.bar.cpython-313.pyc", "foo.bar.py"),
        ("foo.bar.cpython-313.opt-1.pyc", "foo.bar.py"),
        ("räksmörgås.cpython-313.pyc", "räksmörgås.py"),
    ] {
        assert_eq!(risk(bytecode, &[source]), "low", "{bytecode}");
        assert_eq!(risk(bytecode, &[]), "protected", "{bytecode}");
    }
}

#[test]
fn unknown_or_malformed_bytecode_names_remain_protected() {
    for bytecode in [
        "foo.pyc", "foo.backup.pyc", "foo.unknown-313.pyc", "foo.cpython-.pyc",
        "foo.cpython-abc.pyc", "foo.cpython-313.extra.pyc", "foo.cpython-313.opt-.pyc",
        "foo.cpython-313.opt-!.pyc", "foo.cpython-313.opt-1.extra.pyc", ".cpython-313.pyc",
    ] {
        assert_eq!(risk(bytecode, &["foo.py", ".py"]), "protected", "{bytecode}");
    }
}
