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
        self.visit(root, None, 0, protection);
    }
}
