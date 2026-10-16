use super::*;

pub(super) fn recovery_evidence(root: &Path) -> RecoveryEvidence {
    let mut evidence = RecoveryEvidence {
        wrappers: ["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd"].iter().filter(|name| regular(&root.join(name))).map(|name| name.to_string()).collect(),
        node_manifest: "absent".into(),
        // A marker suffices to raise a concern; linked patches are not followed.
        patches: fs::symlink_metadata(root.join("patches")).is_ok() || regular(&root.join(".yarnrc.yml")),
        ..RecoveryEvidence::default()
    };
    if !regular(&root.join("package.json")) { return evidence; }
    evidence.node_manifest = "unreadable".into();
    let Some(text) = small_text(&root.join("package.json")) else { return evidence; };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { evidence.node_manifest = "invalid".into(); return evidence; };
    if !value.is_object() { evidence.node_manifest = "invalid".into(); return evidence; }
    evidence.node_manifest = "parsed".into();
    evidence.package_manager = value.get("packageManager").and_then(|v| v.as_str()).and_then(|v| {
        let manager = v.split('@').next()?;
        ["npm", "pnpm", "yarn", "bun"].contains(&manager).then(|| manager.to_string())
    });
    if let Some(scripts) = value.get("scripts").and_then(|v| v.as_object()) {
        evidence.scripts = scripts.keys().filter(|name| name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_:".contains(c))).take(32).cloned().collect();
        evidence.install_scripts = ["preinstall", "install", "postinstall", "prepare"].iter().any(|name| scripts.contains_key(*name));
    }
    let mut local = BTreeSet::new();
    for section in ["dependencies", "devDependencies", "optionalDependencies"] {
        if let Some(deps) = value.get(section).and_then(|v| v.as_object()) {
            for (name, version) in deps {
                if version.as_str().is_some_and(|v| ["file:", "link:", "workspace:", "./", "../", "/", "git", "github:", "http:", "https:"].iter().any(|prefix| v.starts_with(prefix))) {
                    local.insert(name.chars().take(160).collect::<String>());
                }
            }
        }
    }
    evidence.local_dependency_count = local.len();
    evidence.local_dependencies = local.into_iter().take(20).collect();
    evidence.patches |= value.get("pnpm").and_then(|v| v.get("patchedDependencies")).is_some();
    evidence
}
