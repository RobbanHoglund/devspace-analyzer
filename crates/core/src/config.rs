use std::{collections::HashMap, env, path::{Path, PathBuf}};
use crate::{model::CacheLocation, paths::{display, normalize, small_text}};

#[derive(Debug, Clone)]
pub struct Environment { pub home: PathBuf, pub vars: HashMap<String, String>, pub platform: String }
impl Environment {
    pub fn current() -> Self {
        let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default();
        let vars = env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?))).collect();
        Self { home, vars, platform: env::consts::OS.into() }
    }
    fn var(&self, name: &str) -> Option<String> {
        self.vars.get(name).filter(|s| !s.trim().is_empty()).cloned().or_else(|| {
            if self.platform == "windows" { self.vars.iter().find(|(k, v)| k.eq_ignore_ascii_case(name) && !v.trim().is_empty()).map(|(_, v)| v.clone()) } else { None }
        })
    }
}
fn setting(text: &str, wanted: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.starts_with(';') { continue; }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim().eq_ignore_ascii_case(wanted) { return Some(value.trim().trim_matches('"').trim_matches('\'').into()); }
        }
    }
    None
}
fn expand(value: &str, env: &Environment) -> Option<PathBuf> {
    let mut v = value.trim().replace("${user.home}", &display(&env.home));
    if v == "~" { v = display(&env.home); }
    if let Some(rest) = v.strip_prefix("~/").or_else(|| v.strip_prefix("~\\")) { v = display(&env.home.join(rest)); }
    // A bounded substitution loop prevents self-referential environment variables
    // from blocking a scan indefinitely.
    for _ in 0..16 {
        let Some(start) = v.find("${") else {
            let path = PathBuf::from(v);
            return path.is_absolute().then_some(path);
        };
        let end = start + v[start..].find('}')?;
        let name = &v[start + 2..end];
        let replacement = env.var(name.strip_prefix("env.").unwrap_or(name))?;
        v.replace_range(start..=end, &replacement);
        if v.len() > 32_768 { return None; }
    }
    None
}
fn resolved(env: &Environment, variable: &str, configured: Option<String>, fallback: PathBuf, config_source: &str) -> (PathBuf, String) {
    if let Some(value) = env.var(variable) {
        return (expand(&value, env).unwrap_or_else(|| PathBuf::from(value)), format!("Environment: {variable}"));
    }
    if let Some(value) = configured {
        return (expand(&value, env).unwrap_or_else(|| PathBuf::from(value)), config_source.into());
    }
    (fallback, "Platform default (not CLI-verified)".into())
}
/// Discover only known cache locations. CLI overrides and project-specific settings
/// are intentionally not evaluated. Missing paths are omitted, never created.
pub fn discover(env: &Environment) -> Vec<CacheLocation> {
    if env.home.as_os_str().is_empty() { return vec![]; }
    let win = env.platform == "windows"; let mac = env.platform == "macos";
    let local = env.var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| env.home.join("AppData/Local"));
    let cache_base = if win { local.clone() } else if mac { env.home.join("Library/Caches") } else { env.var("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| env.home.join(".cache")) };
    let npmrc = env.var("NPM_CONFIG_USERCONFIG").map(PathBuf::from).unwrap_or_else(|| env.home.join(".npmrc"));
    let npm_text = small_text(&npmrc).unwrap_or_default();
    let (gradle, gs) = resolved(env, "GRADLE_USER_HOME", None, env.home.join(".gradle"), "");
    let (npm, ns) = resolved(env, "npm_config_cache", setting(&npm_text, "cache"), if win { local.join("npm-cache") } else { env.home.join(".npm") }, "User npm configuration: cache");
    let maven_text = small_text(&env.home.join(".m2/settings.xml")).unwrap_or_default();
    let maven_config = roxmltree::Document::parse(&maven_text).ok().and_then(|doc| {
        doc.root_element().children().find(|n| n.has_tag_name("localRepository")).and_then(|n| n.text()).map(str::to_owned)
    });
    let (maven, ms) = if let Some(config) = maven_config {
        (expand(&config, env).unwrap_or_else(|| PathBuf::from(config)), "User Maven settings.xml: localRepository".into())
    } else { (env.home.join(".m2/repository"), "Platform default (not CLI-verified)".into()) };
    let (pip, ps) = resolved(env, "PIP_CACHE_DIR", None, cache_base.join(if win { "pip/Cache" } else { "pip" }), "");
    let (uv, us) = resolved(env, "UV_CACHE_DIR", None, cache_base.join(if win { "uv/cache" } else { "uv" }), "");
    let pnpm_default = if win { local.join("pnpm/store") } else if mac { env.home.join("Library/pnpm/store") } else { env.var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| env.home.join(".local/share")).join("pnpm/store") };
    let (pnpm, pns) = resolved(env, "npm_config_store_dir", setting(&npm_text, "store-dir"), pnpm_default, "User npm configuration: store-dir");
    let (yarn, ys) = resolved(env, "YARN_CACHE_FOLDER", None, if win { local.join("Yarn/Cache") } else { cache_base.join("yarn") }, "");
    let candidates = vec![
        (gradle.join("caches"), "Gradle", "gradle-caches", gs.clone()),
        (gradle.join("wrapper/dists"), "Gradle", "gradle-wrappers", gs.clone()),
        (gradle.join("jdks"), "Gradle", "toolchains", gs),
        (npm, "Node", "npm-cache", ns), (maven, "Maven", "maven-repository", ms),
        (pip, "Python", "pip-cache", ps), (uv, "Python", "uv-cache", us),
        (pnpm, "Node", "pnpm-store", pns), (yarn, "Node", "yarn-cache", ys),
        (local.join("Docker/wsl"), "Containers", "virtual-disks", "Known Docker Desktop location (not exhaustive)".into()),
    ];
    candidates.into_iter().filter_map(|(p, ecosystem, kind, source)| normalize(Path::new(&p)).ok().map(|path| CacheLocation { path: display(&path), ecosystem: ecosystem.into(), kind: kind.into(), source })).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cyclic_variables_are_rejected() {
        let env = Environment { home: PathBuf::from("/home/example"), platform: "linux".into(), vars: HashMap::from([("CYCLE".into(), "${CYCLE}".into())]) };
        assert!(expand("${CYCLE}", &env).is_none());
    }
}
