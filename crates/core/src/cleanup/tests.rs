use super::*;
fn fixture() -> (TempDir, Request) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("_cacache")).unwrap();
    let cache = fs::canonicalize(dir.path()).unwrap();
    let finding = Finding { id:"f0".into(), path:paths::display(&cache.join("_cacache")), label:"npm".into(), ecosystem:"Node".into(), kind:"npm-cache".into(), risk:"review".into(), confidence:"high".into(), logical_bytes:0, files:0, latest_modified:None, project_id:None, evidence:vec![], reason:String::new(), recovery:String::new(), caveats:vec![], complete:true, user_protected:false, wrapper_version:None, wrapper_references:vec![], protected_descendants:vec![], protected_descendant_count:0 };
    (dir, Request { action:Action::NpmClean, finding, cache:CacheLocation{path:paths::display(&cache), ecosystem:"Node".into(), kind:"npm-cache".into(), source:"test".into()}, protected_paths:vec![] })
}
#[test] fn only_exact_complete_unprotected_cache_is_eligible() {
    let (_dir, mut r) = fixture(); assert!(validate_request(&r).is_ok());
    r.finding.path.push_str("/child"); assert!(validate_request(&r).is_err());
    let (_dir, mut r) = fixture(); r.finding.complete=false; assert!(validate_request(&r).is_err());
    r.finding.complete=true; r.finding.user_protected=true; assert!(validate_request(&r).is_err());
    r.finding.user_protected=false; r.finding.protected_descendant_count=1; assert!(validate_request(&r).is_err());
    let (_dir, mut r) = fixture(); r.action=Action::PipPurge; assert!(validate_request(&r).is_err());
}
#[test] fn protect_ancestor_or_descendant_even_when_missing() {
    for relative in ["", "_cacache", "_cacache/missing"] {
        let (dir, mut r) = fixture(); r.protected_paths=vec![paths::display(&fs::canonicalize(dir.path()).unwrap().join(relative))];
        assert!(validate_request(&r).unwrap_err().contains("protected"));
    }
}
#[test] fn fresh_measurement_blocks_protected_content_and_cancellation() {
    let (dir, _) = fixture(); let root=dir.path().join("_cacache");
    fs::write(root.join("data"), b"1234").unwrap();
    assert_eq!(measure(&root, &AtomicBool::new(false)).unwrap(), (4,1));
    assert!(measure(&root, &AtomicBool::new(true)).is_err());
    fs::create_dir(root.join(".git")).unwrap();
    assert!(measure(&root, &AtomicBool::new(false)).unwrap_err().contains("protected"));
}
#[cfg(unix)]
#[test] fn links_are_blocked_before_a_tool_can_follow_them() {
    let (dir, _) = fixture(); let outside=tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("_cacache/link")).unwrap();
    assert!(measure(&dir.path().join("_cacache"), &AtomicBool::new(false)).is_err());
}
#[test] fn only_a_validated_missing_target_counts_as_zero_after_cleanup() {
    let dir=tempfile::tempdir().unwrap();
    assert_eq!(measure_after(&dir.path().join("removed")).unwrap(), (0,0));
    assert!(measure_after(&dir.path().join("missing/removed")).is_err());
}
#[test] fn unknown_tool_versions_fail_closed() {
    assert!(tools::supported(Action::NpmClean,"11.3.0").is_ok());
    assert!(tools::supported(Action::PipPurge,"pip 24.0 from /python/pip (python 3.12)").is_ok());
    assert!(tools::supported(Action::PnpmPrune,"12.0.0").is_err());
    assert!(tools::supported(Action::NpmClean,"unexpected").is_err());
}
// A child test process exercises cancellation without an external tool dependency.
#[test]
#[ignore]
fn process_fixture() {
    println!("cleanup-fixture-running");
    std::thread::sleep(Duration::from_secs(10));
}
#[test] fn running_command_can_be_cancelled_and_timed_out() {
    let dir=tempfile::tempdir().unwrap();
    let program=std::env::current_exe().unwrap();
    let args=vec!["--ignored".into(),"--exact".into(),"cleanup::tests::process_fixture".into(),"--nocapture".into()];
    let cancel=AtomicBool::new(false);
    let result=process::run(&program,&args,dir.path(),&cancel,Duration::from_secs(5),&mut |text| {
        if text.contains("cleanup-fixture-running") { cancel.store(true,Ordering::Relaxed); }
    }).unwrap();
    assert_eq!(result.status,"cancelled");
    assert!(result.log.contains("cleanup-fixture-running"));
    let result=process::run(&program,&args,dir.path(),&AtomicBool::new(false),Duration::from_millis(150),&mut |_|{}).unwrap();
    assert_eq!(result.status,"timed-out");
}
