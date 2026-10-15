use super::*;

impl<F: FnMut(Progress)> Scanner<'_, F> {
    pub(super) fn rule(&self, path: &Path, owner: Option<usize>, directory: bool) -> Option<Rule> {
        self.rule_with_project(path, owner.map(|i| &self.report.projects[i]), directory)
    }
    pub(super) fn rule_with_project(&self, path: &Path, project: Option<&Project>, directory: bool) -> Option<Rule> {
        let name = path.file_name()?.to_string_lossy();
        // These intrinsic protected types take precedence over a configured
        // cache alias and also work when explicitly selected without a project.
        if !directory && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("vhdx")) {
            return Some(Rule::new("Virtual disk image", "Containers", "virtual-disk", "protected", "A VHDX can contain an entire operating system or persistent volume, not just a disposable cache.", "Inspect from the owning virtualization/container application. Do not delete the image directly.", vec!["VHDX filename extension; contents not opened".into()]));
        }
        if name.eq_ignore_ascii_case(".git") {
            return Some(Rule::new("Git metadata", "Git", "git-metadata", "protected", "Contains history, references or a worktree pointer. Not a build cache.", "Use Git's own repository maintenance after a backup; never delete this as cleanup.", vec!["Git repository/worktree marker".into()]));
        }
        // Safety boundaries must not depend on project inventory: aggregates
        // intentionally do not register every dependency manifest as a project.
        // These names can only add protection, never establish a cleanup candidate.
        if directory && name == ".yarn" {
            return Some(Rule::new("Project Yarn storage", "Node", "yarn-project", "protected", "May include tracked Zero-Install packages, patches, releases and plugins, not just cache.", "Review the Yarn project configuration and tracked files individually.", vec!["Directory named .yarn; protected independently of project discovery".into()]));
        }
        if directory && [".venv", "venv"].contains(&name.as_ref()) && !regular(&path.join("pyvenv.cfg")) {
            return Some(Rule::new("Python virtual environment", "Python", "python-venv", "protected", "This conventional environment directory has no regular pyvenv.cfg. It may contain unique data rather than a recoverable environment.", "Inspect and preserve the contents before considering any changes.", vec!["Environment directory name without a regular pyvenv.cfg".into()]));
        }
        let bytecode_sources = (directory && name == "__pycache__").then(|| bytecode_sources_present(path));
        if bytecode_sources == Some(false) {
            return Some(Rule::new("Python bytecode cache", "Python", "python-bytecode", "protected", "Bytecode recovery could not be established for every entry; source files may be absent or the directory may contain other data.", "Preserve the directory until every entry has a verified source and recovery path.", vec!["Incomplete bytecode recovery evidence; protected independently of project discovery".into()]));
        }
        let protected_cache = |g: &&CacheLocation| matches!(g.kind.as_str(), "maven-repository" | "toolchains" | "virtual-disks") && within(path, Path::new(&g.path));
        let exact = self.report.global_caches.iter().find(protected_cache).or_else(|| self.report.global_caches.iter().find(|g| key(Path::new(&g.path)) == key(path)));
        if let Some(cache) = exact {
            if ["gradle-caches", "gradle-wrappers", "npm-cache"].contains(&cache.kind.as_str()) { return None; }
            let evidence = vec![format!("Location source: {}", cache.source)];
            return Some(match cache.kind.as_str() {
                "maven-repository" => Rule::new("Maven local repository", "Maven", "maven-repository", "protected", "May contain locally installed JARs and snapshots with no remote copy. Never treat the whole repository as disposable.", "Identify each artifact's origin and back up local-only artifacts before a selective review.", evidence),
                "toolchains" => Rule::new("Gradle Java toolchains", "Gradle", "toolchains", "protected", "Downloaded JDKs can be required by current builds. Wrapper versions alone do not establish JDK usage.", "Check project toolchain requirements and available replacement JDKs.", evidence),
                "virtual-disks" => Rule::new("Container virtual disks", "Containers", "virtual-disks", "protected", "Virtual disks may contain images, containers, volumes and user data. The logical file size is not physical disk use.", "Use the container platform's own inventory tools. Never delete a VHDX to reclaim cache space.", evidence),
                _ => Rule::new(&format!("{} shared cache", cache.kind), &cache.ecosystem, &cache.kind, "review", "Known package cache/store location. Its contents have not been matched to every installed environment or remote source.", "Review through the owning package manager. Downloads, builds and shared/hardlinked installations may be affected.", evidence),
            });
        }
        if let Some(cache) = self.report.global_caches.iter().find(|g| path.parent().is_some_and(|p| key(p) == key(Path::new(&g.path)))) {
            let evidence = vec![format!("Location source: {}", cache.source), format!("Cache category: {}", cache.kind)];
            if cache.kind == "gradle-wrappers" && directory {
                let mut rule = Rule::new("Gradle wrapper distribution", "Gradle", "gradle-wrapper", "review", "A local wrapper distribution. Reference checks cover only the wrappers discovered in this scan, not all usage.", "Gradle normally manages distribution cleanup. A removed distribution must be downloaded again before its next build.", evidence);
                rule.wrapper_version = version(&name);
                if rule.wrapper_version.is_none() { rule.risk = "protected".into(); rule.label = "Unrecognized wrapper storage".into(); }
                return Some(rule);
            }
            if cache.kind == "gradle-caches" && directory {
                let known = name.starts_with(|c: char| c.is_ascii_digit()) || ["modules-", "transforms-", "jars-", "build-cache-"].iter().any(|prefix| name.starts_with(prefix));
                return Some(Rule::new("Gradle cache", "Gradle", "gradle-cache", if known { "review" } else { "protected" }, "Gradle has its own automatic cache retention. Dependency caches can also be the only available offline copy.", "Inspect Gradle's retention settings before manual intervention. Rebuilds and dependency downloads may be needed.", evidence));
            }
            if cache.kind == "npm-cache" && directory {
                let label = match name.as_ref() { "_cacache" => "npm package cache", "_npx" => "npx environments", "_logs" => "npm diagnostic logs", _ => "Unrecognized npm storage" };
                return Some(Rule::new(label, "Node", "npm-cache", if ["_cacache", "_npx", "_logs"].contains(&name.as_ref()) { "review" } else { "protected" }, "Storage under the configured npm cache. npx environments, package content and diagnostic logs have different recovery costs.", "Review with npm's own cache tools. Even npm cache verify can change the cache; this scanner never runs it.", evidence));
            }
        }
        let p = project?;
        let direct = path.parent().is_some_and(|parent| key(parent) == key(Path::new(&p.path)));
        let has = |ecosystem: &str| p.ecosystems.iter().any(|e| e == ecosystem);
        let evidence = vec![format!("Project markers: {}", p.markers.join(", ")), if p.lockfiles.is_empty() { "No recognized lockfile in this project directory".into() } else { format!("Lockfiles present: {} (not validated)", p.lockfiles.join(", ")) }];
        if !directory { return None; }
        if name == "__pycache__" && has("Python") {
            return Some(Rule::new("Python bytecode cache", "Python", "python-bytecode", "low", "Only .pyc filenames were found and each has a matching .py source filename in the parent directory. Sources were not executed or read.", "Python normally regenerates bytecode from source. Verify that sources and the required interpreter are available.", evidence));
        }
        if !direct { return None; }
        if has("Gradle") && ["build", ".gradle"].contains(&name.as_ref()) {
            return Some(Rule::new("Gradle project artifacts", "Gradle", "gradle-project", "review", "Conventional Gradle output/cache directory next to a recognized build. Custom outputs and tracked files remain possible.", "Review the project's configured outputs and back up unique files. A subsequent build recreates conventional outputs.", evidence));
        }
        if has("Maven") && name == "target" {
            return Some(Rule::new("Maven project output", "Maven", "maven-output", "review", "Conventional target directory next to pom.xml; custom or tracked files have not been excluded.", "Review the contents and project configuration. Rebuilding can recreate normal Maven output.", evidence));
        }
        if has("Node") && ["node_modules", "dist", "build", ".next", ".nuxt", ".parcel-cache", ".turbo"].contains(&name.as_ref()) {
            let modules = name == "node_modules";
            return Some(Rule::new(if modules { "Installed Node dependencies" } else { "Possible Node build artifacts" }, "Node", if modules { "node-modules" } else { "node-output" }, "review", if modules { "Installed dependencies next to package.json. Lockfiles help but do not prove recovery of local packages, patches, install scripts or unpublished versions." } else { "Conventional build/cache directory next to package.json. Directory naming alone does not establish that every file is disposable." }, "Check the lockfile, local/file dependencies, package availability and any manual patches before reinstalling or rebuilding.", evidence));
        }
        if has("Python") && [".venv", "venv"].contains(&name.as_ref()) {
            return Some(Rule::new("Python virtual environment", "Python", "python-venv", "review", "A virtual environment may contain manually installed or editable local packages. A manifest/lockfile is not a complete recovery guarantee.", "Record the interpreter and package origins, check local/editable dependencies, then rebuild from a verified lock or requirements file.", evidence));
        }
        if has("Python") && [".pytest_cache", ".mypy_cache", ".ruff_cache"].contains(&name.as_ref()) {
            return Some(Rule::new("Python tooling cache", "Python", "python-tool-cache", "review", "Conventional tool cache next to a Python project. Tracking and unique files have not been verified.", "The owning tool usually rebuilds its cache; review the directory and close running jobs first.", evidence));
        }
        None
    }
}
