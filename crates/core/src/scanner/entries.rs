use std::{collections::{BTreeSet, VecDeque}, ffi::OsString, fs, io, path::Path, sync::atomic::{AtomicBool, Ordering}};

// Most source/cache directories are small. Look at their existing directory
// listing before probing missing manifests or .git through every ancestor.
// Large/erroring listings fall back to the original probes and stream onward.
const PREFETCH_LIMIT: usize = 256;

pub(super) struct Entries {
    buffered: VecDeque<io::Result<fs::DirEntry>>,
    remaining: Option<fs::ReadDir>,
    pub names: Option<BTreeSet<OsString>>,
}

pub(super) fn may_contain(names: Option<&BTreeSet<OsString>>, name: &str) -> bool {
    names.is_none_or(|names| names.contains(&OsString::from(name).to_ascii_lowercase()))
}

impl Entries {
    pub fn open(path: &Path, cancelled: &AtomicBool) -> io::Result<Self> {
        let mut remaining = fs::read_dir(path)?;
        let mut buffered = VecDeque::new();
        let mut names = BTreeSet::new();
        let mut complete = true;
        for _ in 0..PREFETCH_LIMIT {
            if cancelled.load(Ordering::Relaxed) { break; }
            let Some(entry) = remaining.next() else {
                return Ok(Self { buffered, remaining: None, names: complete.then_some(names) });
            };
            if let Ok(entry) = &entry {
                // Hints must work on both case-sensitive and case-insensitive
                // volumes (including macOS). A possible match still goes through
                // the original filesystem/no-follow probe; folding only avoids
                // false negatives, it does not establish a marker by itself.
                let name = entry.file_name().to_ascii_lowercase();
                names.insert(name);
            } else { complete = false; }
            buffered.push_back(entry);
        }
        Ok(Self { buffered, remaining: Some(remaining), names: None })
    }
}

impl Iterator for Entries {
    type Item = io::Result<fs::DirEntry>;
    fn next(&mut self) -> Option<Self::Item> {
        self.buffered.pop_front().or_else(|| self.remaining.as_mut().and_then(Iterator::next))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_case_markers_are_not_rejected_by_normalized_name_hints() {
        // Windows directory listings already normalize these names. The lookup
        // must normalize the mixed-case spellings in MARKERS and LOCKS too.
        let names = BTreeSet::from([OsString::from("pipfile"), OsString::from("pipfile.lock")]);
        assert!(may_contain(Some(&names), "Pipfile"));
        assert!(may_contain(Some(&names), "Pipfile.lock"));
        assert!(!may_contain(Some(&names), "package.json"));
    }
}
