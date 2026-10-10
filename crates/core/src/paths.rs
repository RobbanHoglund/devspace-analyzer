use std::{fs, io::{self, Read}, path::{Component, Path, PathBuf}};

pub fn display(path: &Path) -> String { path.to_string_lossy().into_owned() }
pub fn key(path: &Path) -> String {
    let text = display(path);
    #[cfg(windows)]
    { text.replace('\\', "/").to_lowercase() }
    #[cfg(not(windows))]
    { text }
}
pub fn within(path: &Path, root: &Path) -> bool {
    let p = key(path); let r = key(root);
    p == r || p.starts_with(&(r.trim_end_matches('/').to_string() + "/"))
}
pub fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() { return true; }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return true; }
    }
    false
}
/// Refuse links in every existing ancestor, including explicitly selected roots.
/// This is a non-adversarial snapshot check, not a race-free filesystem sandbox.
pub fn safe_path(path: &Path) -> bool {
    path.ancestors().filter(|p| !p.as_os_str().is_empty()).all(|p| {
        fs::symlink_metadata(p).map(|m| !is_link(&m)).unwrap_or(false)
    })
}
pub fn normalize(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() { return Err("Choose an absolute local directory.".into()); }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Parent-directory components are not accepted.".into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if path.components().any(|c| matches!(c, Component::Prefix(p) if !matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))) {
            return Err("Network shares and device paths are outside the local scan scope.".into());
        }
    }
    if !safe_path(path) { return Err("Missing, inaccessible or linked directory (links/reparse points are not followed).".into()); }
    let full = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !full.is_dir() { return Err("The selected path is not a directory.".into()); }
    Ok(full)
}
pub fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.is_file() && !is_link(&m)).unwrap_or(false)
}
/// Only called for allowlisted manifests/configuration fields. Never stores raw contents.
pub fn small_text(path: &Path) -> Option<String> {
    if !safe_path(path) { return None; }
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || is_link(&meta) || meta.len() > 65_536 { return None; }
    let mut text = String::new();
    fs::File::open(path).ok()?.take(65_537).read_to_string(&mut text).ok()?;
    (text.len() <= 65_536).then_some(text)
}
pub fn child_names(path: &Path) -> io::Result<Vec<String>> {
    fs::read_dir(path)?.take(10_001).map(|entry| {
        entry.map(|e| e.file_name().to_string_lossy().into_owned())
    }).collect()
}
