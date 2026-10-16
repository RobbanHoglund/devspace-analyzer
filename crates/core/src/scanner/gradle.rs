use super::*;

const MAX_MODULES: usize = 1024;

#[derive(PartialEq)]
enum Token { Word(String), Text(String), Symbol(char), Line }

// A deliberately small lexer, not a Groovy/Kotlin evaluator. Comments and
// strings cannot invent declarations; expressions are never evaluated.
fn tokens(text: &str) -> Vec<Token> {
    let mut chars = text.chars().peekable();
    let mut out = Vec::new();
    while let Some(c) = chars.next() {
        match c {
            '\n' => out.push(Token::Line),
            c if c.is_whitespace() => {},
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() { if c == '\n' { out.push(Token::Line); break; } }
            },
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut nesting = 1;
                while let Some(c) = chars.next() {
                    if c == '/' && chars.peek() == Some(&'*') { chars.next(); nesting += 1; }
                    if c == '*' && chars.peek() == Some(&'/') { chars.next(); nesting -= 1; if nesting == 0 { break; } }
                }
            },
            '\'' | '"' => {
                let mut value = String::new(); let mut closed = false;
                while let Some(next) = chars.next() {
                    if next == c { closed = true; break; }
                    value.push(next);
                    if next == '\\' { if let Some(escaped) = chars.next() { value.push(escaped); } }
                }
                out.push(if closed { Token::Text(value) } else { Token::Symbol('?') });
            },
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut word = c.to_string();
                while chars.peek().is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_') { word.push(chars.next().unwrap()); }
                out.push(Token::Word(word));
            },
            c => out.push(Token::Symbol(c)),
        }
    }
    out
}

fn includes(text: &str) -> (BTreeSet<PathBuf>, bool) {
    let t = tokens(text);
    // Remapped directories/build files or applied scripts invalidate default
    // module paths. Do not guess their effective configuration.
    if t.iter().any(|t| matches!(t, Token::Word(w) if ["projectDir", "setProjectDir", "buildFileName", "setBuildFileName", "apply", "includeFlat"].contains(&w.as_str()))) { return (BTreeSet::new(), true); }
    let mut paths = BTreeSet::new(); let mut uncertain = false; let mut braces = 0usize;
    for (i, token) in t.iter().enumerate() {
        if token == &Token::Symbol('{') { braces += 1; }
        if token == &Token::Symbol('}') { braces = braces.saturating_sub(1); }
        if !matches!(token, Token::Word(w) if w == "include") { continue; }
        if braces != 0 || (i > 0 && !matches!(t[i-1], Token::Line | Token::Symbol(';') | Token::Symbol('}'))) {
            uncertain = true; continue;
        }
        let mut j = i + 1;
        let parens = t.get(j) == Some(&Token::Symbol('('));
        if parens { j += 1; }
        let mut names = Vec::new(); let mut need_name = true; let mut valid = true; let mut closed = !parens;
        while let Some(token) = t.get(j) {
            match token {
                Token::Line if parens => {},
                Token::Line | Token::Symbol(';') if !parens => break,
                Token::Symbol(')') if parens => { closed = true; break; },
                Token::Text(name) if need_name => { names.push(name); need_name = false; },
                Token::Symbol(',') if !need_name => { need_name = true; },
                _ => { valid = false; break; },
            }
            j += 1;
        }
        if !valid || !closed || names.is_empty() || (need_name && !parens) { uncertain = true; continue; }
        let mut declared = BTreeSet::new();
        for name in names {
            let mut path = PathBuf::new();
            for segment in name.strip_prefix(':').unwrap_or(name).split(':') {
                if segment.is_empty() || segment == "." || segment == ".." || !segment.chars().all(|c| c.is_ascii_alphanumeric() || ['_', '-', '.'].contains(&c)) { valid = false; break; }
                path.push(segment); declared.insert(path.clone());
            }
        }
        if !valid || paths.len() + declared.len() > MAX_MODULES { uncertain = true; continue; }
        paths.extend(declared);
    }
    (paths, uncertain)
}

impl<F: FnMut(Progress)> Scanner<'_, F> {
    pub(super) fn project_at(&mut self, path: &Path, index: usize) -> Option<Project> {
        let mut p = project(path, index).or_else(|| {
            let settings = self.gradle_modules.get(&key(path))?;
            Some(Project {
                id: format!("p{index}"), name: path.file_name()?.to_string_lossy().into(), path: display(path),
                ecosystems: vec!["Gradle".into()], markers: vec![format!("Static module declaration in {}", display(settings))],
                lockfiles: LOCKS.iter().filter(|m| regular(&path.join(m))).map(|m| m.to_string()).collect(),
                git_kind: None, branch: None, wrapper_version: None, workspace: false, context_only: false,
                owned_logical_bytes: 0, artifact_bytes: 0, recovery_evidence: Some(evidence::recovery_evidence(path)),
            })
        })?;
        // A declared module can have an unrelated manifest as well.
        if self.gradle_modules.contains_key(&key(path)) && !p.ecosystems.iter().any(|e| e == "Gradle") {
            p.ecosystems.push("Gradle".into());
            p.markers.push(format!("Static module declaration in {}", display(&self.gradle_modules[&key(path)])));
        }
        if !self.gradle_checked.insert(key(path)) { return Some(p); }
        let files: Vec<_> = ["settings.gradle", "settings.gradle.kts"].iter().map(|n| path.join(n)).filter(|p| fs::symlink_metadata(p).is_ok()).collect();
        if files.len() > 1 {
            self.warn(path, "gradle-settings", "Multiple Gradle settings files; module paths were not inferred.");
        } else if let Some(settings) = files.first() {
            if let Some(text) = small_text(settings) {
                let (modules, uncertain) = includes(&text);
                if uncertain { self.warn(settings, "gradle-settings", "Some Gradle module paths could not be resolved statically. Dynamic includes, remapping and applied scripts are not evaluated; artifact coverage may be incomplete."); }
                for module in modules {
                    if self.gradle_modules.len() >= MAX_PROJECTS {
                        self.warn(settings, "gradle-settings", "Static module context limit reached; further module paths were not inferred."); break;
                    }
                    self.gradle_modules.insert(key(&path.join(module)), settings.clone());
                }
            } else {
                self.warn(settings, "gradle-settings", "Gradle settings could not be read within the no-follow and 64 KiB limits; module paths were not inferred.");
            }
        }
        Some(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_only_literal_top_level_includes() {
        let (paths, uncertain) = includes("// include 'fake'\nrootProject.name = \"include('fake')\"\ninclude 'api', ':lib:core'\ninclude(\n\"web\",\n)\n");
        assert!(!uncertain);
        assert_eq!(paths, ["api", "lib", "lib/core", "web"].map(PathBuf::from).into());
        for text in ["include(projectName)", "include(\":api\" + suffix)", "if (flag) { include(':api') }", "include '../escape'", "include(':api')\nproject(':api').projectDir = file('../outside')", "include(\"${name}\")"] {
            let (paths, uncertain) = includes(text);
            assert!(uncertain, "{text}"); assert!(paths.is_empty(), "{text}");
        }
    }
}
