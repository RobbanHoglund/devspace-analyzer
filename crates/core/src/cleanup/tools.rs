use super::{Action, process};
use std::{env, fs, path::{Path, PathBuf}, sync::atomic::AtomicBool, time::{Duration, SystemTime}};

pub(super) struct Tool { pub executable: PathBuf, prefix: Vec<String>, identities: Vec<(PathBuf, u64, SystemTime)> }
fn executable(name: &str) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?).filter(|dir| dir.is_absolute() && dir.file_name().is_none_or(|n| n != ".bin"))
        .map(|dir| dir.join(name)).find(|file| file.is_file()).and_then(|p| fs::canonicalize(p).ok())
}
fn node_cli(name: &str, filename: &str) -> Result<Tool, String> {
    let node = executable(if cfg!(windows) { "node.exe" } else { "node" }).ok_or("Node.js is not on the host PATH.")?;
    let script = if cfg!(windows) {
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).filter(|dir| dir.is_absolute())
            .map(|dir| dir.join("node_modules").join(name).join("bin").join(filename)).find(|p| p.is_file())
            .or_else(|| node.parent().map(|p| p.join("node_modules").join(name).join("bin").join(filename)).filter(|p| p.is_file()))
    } else { executable(name).filter(|p| p.file_name().is_some_and(|n| n == filename)) };
    let script = script.and_then(|p| fs::canonicalize(p).ok()).ok_or_else(|| format!("A direct {name} CLI installation was not found. Install {name} alongside Node.js; Corepack and shell wrappers are not executed."))?;
    // Use ordinary drive paths at the CLI boundary; retain canonical
    // namespaced paths separately for identity/revalidation checks.
    Tool::new(node, vec![cli_path(&script)], vec![script])
}
impl Tool {
    fn new(executable: PathBuf, prefix: Vec<String>, mut files: Vec<PathBuf>) -> Result<Self, String> {
        files.push(executable.clone());
        let identities = files.into_iter().map(|p| {
            let m = fs::metadata(&p).map_err(|_| "Cannot inspect the installed tool.")?;
            Ok((p, m.len(), m.modified().map_err(|_| "Cannot inspect tool modification time.")?))
        }).collect::<Result<_, String>>()?;
        Ok(Self { executable, prefix, identities })
    }
    pub fn revalidate(&self) -> Result<(), String> {
        for (path, len, modified) in &self.identities {
            let m = fs::symlink_metadata(path).map_err(|_| "The installed tool changed. Prepare again.")?;
            if !m.is_file() || m.len() != *len || m.modified().ok() != Some(*modified) || fs::canonicalize(path).ok().as_ref() != Some(path) {
                return Err("The installed tool changed. Prepare again.".into());
            }
        }
        Ok(())
    }
    pub fn version(&self, cwd: &Path, cancelled: &AtomicBool) -> Result<String, String> {
        let mut args = self.prefix.clone(); args.push("--version".into());
        let result = self.execute(&args, cwd, cancelled, Duration::from_secs(20), &mut |_| {})?;
        if result.status != "succeeded" {
            let detail: String = result.log.chars().take(2000).collect();
            return Err(format!("Could not read the installed tool version ({}; exit {:?}). Check the direct CLI installation. {}", result.status, result.code, detail.trim()));
        }
        let version = result.log.trim().to_owned();
        if version.len() > 500 { return Err("Unexpected tool version response.".into()); } Ok(version)
    }
    pub fn arguments(&self, action: Action, cache: &Path) -> Vec<String> {
        let mut args = self.prefix.clone(); let cache = cli_path(cache);
        match action {
            Action::NpmVerify | Action::NpmClean => {
                args.extend(["--global".into(), format!("--cache={cache}"), "--logs-max=0".into(), "--ignore-scripts".into(), "--offline".into(), "cache".into(), if action == Action::NpmVerify { "verify" } else { "clean" }.into()]);
                if action == Action::NpmClean { args.push("--force".into()); }
            },
            Action::PnpmPrune => args.extend([format!("--store-dir={cache}"), "--config.ignore-pnpmfile=true".into(), "--config.manage-package-manager-versions=false".into(), "--config.package-manager-strict=false".into(), "store".into(), "prune".into()]),
            Action::PipPurge => args.extend(["--disable-pip-version-check".into(), "--no-input".into(), format!("--cache-dir={cache}"), "cache".into(), "purge".into()]),
        }
        args
    }
    pub fn probe_store(&self, cache: &Path, cwd: &Path, cancelled: &AtomicBool) -> Result<String, String> {
        let mut args = self.arguments(Action::PnpmPrune, cache); *args.last_mut().unwrap() = "path".into();
        let result = self.execute(&args, cwd, cancelled, Duration::from_secs(20), &mut |_| {})?;
        if result.status != "succeeded" { return Err("pnpm could not resolve the selected store.".into()); }
        Ok(result.log)
    }
    pub fn execute(&self, args: &[String], cwd: &Path, cancelled: &AtomicBool, timeout: Duration, log: &mut impl FnMut(&str)) -> Result<process::Execution, String> {
        process::run(Path::new(&cli_path(&self.executable)), args, cwd, cancelled, timeout, log)
    }
}
pub(super) fn resolve(action: Action, cache: &Path) -> Result<Tool, String> {
    let tool = match action {
        Action::NpmVerify | Action::NpmClean => node_cli("npm", "npm-cli.js")?,
        Action::PnpmPrune => node_cli("pnpm", "pnpm.cjs")?,
        Action::PipPurge => {
            let program = executable(if cfg!(windows) { "python.exe" } else { "python3" }).ok_or("Python is not on the host PATH. Install Python with pip to use this action.")?;
            // -I ignores PYTHONPATH, user site packages and the working directory.
            Tool::new(program, vec!["-I".into(), "-m".into(), "pip".into()], vec![])?
        },
    };
    if tool.identities.iter().any(|(p, _, _)| crate::paths::within(p, cache)) { return Err("The tool itself is inside the selected cache. Cleanup is blocked.".into()); }
    Ok(tool)
}
pub(super) fn supported(action: Action, version: &str) -> Result<(), String> {
    let value = if action == Action::PipPurge { version.strip_prefix("pip ").unwrap_or("").split_whitespace().next().unwrap_or("") } else { version.trim() };
    let major = value.split('.').next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let supported = match action { Action::NpmVerify | Action::NpmClean => (8..=11).contains(&major), Action::PnpmPrune => (8..=10).contains(&major), Action::PipPurge => (21..=26).contains(&major) };
    if !supported { return Err("Unsupported tool version. This release supports npm 8–11, pnpm 8–10 and pip 21–26. Use the owning tool's guidance for other versions.".into()); } Ok(())
}
pub(super) fn cli_path(path: &Path) -> String { let text = path.to_string_lossy(); text.strip_prefix(r"\\?\").unwrap_or(&text).into() }
pub(super) fn display_command(program: &str, args: &[String]) -> (String, String) {
    if cfg!(windows) {
        let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
        (format!("& {} {}", quote(program), args.iter().map(|s| quote(s)).collect::<Vec<_>>().join(" ")), "PowerShell".into())
    } else {
        let quote = |s: &str| format!("'{}'", s.replace('\'', "'\"'\"'"));
        (std::iter::once(program).chain(args.iter().map(String::as_str)).map(quote).collect::<Vec<_>>().join(" "), "POSIX shell".into())
    }
}
