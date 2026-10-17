use super::*;

impl<F: FnMut(Progress)> Scanner<'_, F> {
    pub(super) fn visit_root(&mut self, root: &Path) {
        // Normalization already rejected linked ancestors. Inspect context only:
        // never enumerate or measure sibling trees outside the effective root.
        for (depth, ancestor) in root.ancestors().enumerate() {
            if self.halted() { return; }
            if depth > MAX_DEPTH {
                self.warn(root, "context-limit", "Ancestor context exceeds the supported depth. This root was not scanned.");
                return;
            }
            if self.excluded(ancestor) { return; }
        }
        let protection = root.ancestors().skip(1).find_map(|ancestor| {
            let mut rule = self.rule(ancestor, None, true)?;
            if rule.risk != "protected" { return None; }
            rule.evidence.push(format!("Protection inherited from enclosing storage: {}", display(ancestor)));
            Some(rule)
        });
        if protection.is_some() {
            self.visit(root, None, 0, protection, None);
            return;
        }
        let (context, storage) = self.root_context(root);
        let owner = context.and_then(|mut p| {
            if let Some(index) = self.report.projects.iter().position(|existing| key(Path::new(&existing.path)) == key(Path::new(&p.path))) { return Some(index); }
            if self.report.projects.len() >= MAX_PROJECTS {
                self.warn(root, "project-limit", "Project limit reached."); self.stopped = true; return None;
            }
            let index = self.report.projects.len();
            p.id = format!("p{index}"); p.context_only = true;
            self.report.projects.push(p);
            Some(index)
        });
        self.visit(root, owner, 0, storage, None);
    }

    fn root_context(&mut self, root: &Path) -> (Option<Project>, Option<Rule>) {
        let ancestors: Vec<_> = root.ancestors().skip(1).collect();
        let selected_project = project(root, 0).is_some();
        let mut context = None;
        // Walk outside-in: an installed package inside node_modules is storage,
        // not a new source project, even if it contains its own manifest.
        for ancestor in ancestors.into_iter().rev() {
            if self.halted() { break; }
            if let Some(mut rule) = self.rule_with_project(ancestor, context.as_ref(), true) {
                // An explicitly selected source project inside generic output
                // keeps its own identity. Installed Node packages/shared caches
                // remain storage; intrinsic protection was already inherited.
                if selected_project && ["node-output", "gradle-project", "maven-output", "python-venv"].contains(&rule.kind.as_str()) {
                    return (None, None);
                }
                rule.evidence.push(format!("Storage category inherited from: {}. Only the selected subtree was measured.", display(ancestor)));
                return (context, Some(rule));
            }
            if let Some(p) = self.project_at(ancestor, 0) { context = Some(p); }
        }
        // A source project selected in its own right owns its own inventory.
        if self.project_at(root, 0).is_some() && self.rule_with_project(root, context.as_ref(), true).is_none() { context = None; }
        (context, None)
    }
}
