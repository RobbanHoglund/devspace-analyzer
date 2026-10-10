use std::{collections::HashMap, env, fs, path::{Path, PathBuf}};
use crate::{model::{CacheLocation, ScanWarning}, npmrc, paths::{display, normalize, small_text}};

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
    fn override_value(&self, name: &str) -> Option<Result<String, &'static str>> {
        if !name.to_ascii_lowercase().starts_with("npm_config_") { return self.var(name).map(Ok); }
        // npm names are case-insensitive even on Unix. Do not make unrelated
        // Unix environment names case-insensitive or guess conflicting values.
        let values: Vec<&String> = self.vars.iter().filter(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value).collect();
        let first = *values.first()?;
        Some(if values.iter().any(|v| *v != first) {
            Err("Conflicting case variants of an npm environment setting; location not inferred.")
        } else if first.trim().is_empty() {
            Err("An empty npm environment setting is not a usable cache path.")
        } else { Ok(first.clone()) })
    }
}

#[derive(Debug, Default)]
pub struct Discovery { pub locations: Vec<CacheLocation>, pub warnings: Vec<ScanWarning> }
fn diagnostic(warnings: &mut Vec<ScanWarning>, source: &str, message: &str) {
    // Never include the rejected raw value: it could contain credentials.
    warnings.push(ScanWarning { path: source.into(), code: "cache-configuration".into(), message: message.into() });
}
fn expand(value: &str, env: &Environment) -> Option<PathBuf> {
    let mut v = value.trim().replace("${user.home}", &display(&env.home));
    if v == "~" { v = display(&env.home); }
    if let Some(rest) = v.strip_prefix("~/").or_else(|| v.strip_prefix("~\\")) { v = display(&env.home.join(rest)); }
    for _ in 0..16 {
        let Some(start) = v.find("${") else {
            if v.len() > 32_768 || v.chars().any(char::is_control) { return None; }
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
fn resolved(env: &Environment, variable: &str, configured: Option<Result<String, &'static str>>, fallback: PathBuf, config_source: &str, warnings: &mut Vec<ScanWarning>) -> Option<(PathBuf, String)> {
    let explicit = if let Some(value) = env.override_value(variable) {
        Some((value, format!("Environment: {variable}")))
    } else { configured.map(|value| (value, config_source.to_owned())) };
    let Some((value, source)) = explicit else { return Some((fallback, "Platform default (not CLI-verified)".into())); };
    match value {
        Ok(raw) => match expand(&raw, env) {
            Some(path) => Some((path, source)),
            None => { diagnostic(warnings, &source, "Configured path is invalid, relative or contains unresolved variables. No default fallback was used."); None }
        },
        Err(message) => { diagnostic(warnings, &source, message); None }
    }
}
fn read_config(path: &Path, source: &str, explicit: bool, warnings: &mut Vec<ScanWarning>) -> Option<String> {
    if let Some(text) = small_text(path) { return Some(text); }
    if explicit || fs::symlink_metadata(path).is_ok() {
        diagnostic(warnings, source, "Configuration could not be read within the local no-follow and 64 KiB limits; custom locations may be missing.");
    }
    None
}
/// Location identity is discovered independently of traversal scope. No package
/// manager runs and no missing directory is created. Only valid locations return.
pub fn discover(env: &Environment) -> Vec<CacheLocation> { discover_with_warnings(env).locations }
pub fn discover_with_warnings(env: &Environment) -> Discovery {
    let mut out = Discovery::default();
    if env.home.as_os_str().is_empty() { return out; }
    let warnings = &mut out.warnings;
    let win = env.platform == "windows"; let mac = env.platform == "macos";
    let local = env.var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| env.home.join("AppData/Local"));
    let xdg = env.var("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| env.home.join(".cache"));
    let pip_base = if win { local.clone() } else if mac { env.home.join("Library/Caches") } else { xdg.clone() };
    let npmrc_override = env.override_value("npm_config_userconfig").is_some();
    let npmrc_path = resolved(env, "npm_config_userconfig", None, env.home.join(".npmrc"), "", warnings);
    let npm_text = npmrc_path.and_then(|(p, _)| read_config(&p, "User npm configuration", npmrc_override, warnings));
    let (cache_setting, store_setting) = if let Some(text) = &npm_text {
        (npmrc::setting(text, "cache"), npmrc::setting(text, "store-dir"))
    } else if npmrc_override || fs::symlink_metadata(env.home.join(".npmrc")).is_ok() {
        (Some(Err("User npm configuration is unresolved; no default cache location inferred.")), Some(Err("User npm configuration is unresolved; no default store location inferred.")))
    } else { (None, None) };
    let gradle = resolved(env, "GRADLE_USER_HOME", None, env.home.join(".gradle"), "", warnings);
    let npm = resolved(env, "npm_config_cache", cache_setting, if win { local.join("npm-cache") } else { env.home.join(".npm") }, "User npm configuration: cache", warnings);
    let maven_text = read_config(&env.home.join(".m2/settings.xml"), "User Maven settings.xml", false, warnings);
    let maven_config = maven_text.as_ref().and_then(|text| match roxmltree::Document::parse(text) {
        Ok(doc) => doc.root_element().children().find(|n| n.has_tag_name("localRepository")).and_then(|n| n.text()).map(|s| Ok(s.to_owned())),
        Err(_) => Some(Err("Invalid Maven settings XML; no repository fallback inferred.")),
    });
    let maven = resolved(env, "DEVSPACE_UNUSED_MAVEN_OVERRIDE", maven_config, env.home.join(".m2/repository"), "User Maven settings.xml: localRepository", warnings);
    let pip = resolved(env, "PIP_CACHE_DIR", None, pip_base.join(if win { "pip/Cache" } else { "pip" }), "", warnings);
    // uv intentionally differs from pip on macOS.
    let uv_default = if win { local.join("uv/cache") } else { xdg.join("uv") };
    let uv = resolved(env, "UV_CACHE_DIR", None, uv_default, "", warnings);
    let pnpm_default = if win { local.join("pnpm/store") } else if mac { env.home.join("Library/pnpm/store") } else { env.var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| env.home.join(".local/share")).join("pnpm/store") };
    let pnpm = resolved(env, "npm_config_store_dir", store_setting, pnpm_default, "User npm configuration: store-dir", warnings);
    let yarn = resolved(env, "YARN_CACHE_FOLDER", None, if win { local.join("Yarn/Cache") } else if mac { env.home.join("Library/Caches/yarn") } else { xdg_yarn(env) }, "", warnings);
    let mut candidates = vec![];
    if let Some((home, source)) = gradle {
        candidates.extend([(Some((home.join("caches"), source.clone())), "Gradle", "gradle-caches"), (Some((home.join("wrapper/dists"), source.clone())), "Gradle", "gradle-wrappers"), (Some((home.join("jdks"), source)), "Gradle", "toolchains")]);
    }
    candidates.extend([(npm, "Node", "npm-cache"), (maven, "Maven", "maven-repository"), (pip, "Python", "pip-cache"), (uv, "Python", "uv-cache"), (pnpm, "Node", "pnpm-store"), (yarn, "Node", "yarn-cache")]);
    if win { candidates.push((Some((local.join("Docker/wsl"), "Known Docker Desktop location (not exhaustive)".into())), "Containers", "virtual-disks")); }
    for (location, ecosystem, kind) in candidates {
        let Some((path, source)) = location else { continue; };
        match normalize(&path) {
            Ok(path) => out.locations.push(CacheLocation { path: display(&path), ecosystem: ecosystem.into(), kind: kind.into(), source }),
            Err(_) if source.starts_with("Environment:") || source.starts_with("User ") => diagnostic(warnings, &source, "Configured directory is missing, inaccessible or outside the local no-follow policy. It was not scanned."),
            Err(_) => {}
        }
    }
    // Resolve overlapping identities conservatively: a protected cache must win
    // over a review-only cache configured at the exact same path.
    out.locations.sort_by_key(|c| !matches!(c.kind.as_str(), "maven-repository" | "toolchains" | "virtual-disks"));
    out
}
fn xdg_yarn(env: &Environment) -> PathBuf { env.var("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| env.home.join(".cache")).join("yarn") }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cyclic_variables_are_rejected() {
        let env = Environment { home: PathBuf::from("/home/example"), platform: "linux".into(), vars: HashMap::from([("CYCLE".into(), "${CYCLE}".into())]) };
        assert!(expand("${CYCLE}", &env).is_none());
    }
    #[test]
    fn only_npm_overrides_ignore_case_on_unix() {
        let env = Environment { home: PathBuf::from("/home/example"), platform: "linux".into(), vars: HashMap::from([("NPM_CONFIG_CACHE".into(), "/cache".into()), ("uv_cache_dir".into(), "/wrong".into())]) };
        assert_eq!(env.override_value("npm_config_cache"), Some(Ok("/cache".into())));
        assert!(env.override_value("UV_CACHE_DIR").is_none());
    }
    #[test]
    fn conflicting_npm_environment_values_are_not_guessed() {
        let env = Environment { home: PathBuf::from("/home/example"), platform: "linux".into(), vars: HashMap::from([("NPM_CONFIG_CACHE".into(), "/one".into()), ("npm_config_cache".into(), "/two".into())]) };
        assert!(env.override_value("npm_config_cache").unwrap().is_err());
    }
}
