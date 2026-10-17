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
    names.is_none_or(|names| names.contains(&OsString::from(name)))
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
                let name = entry.file_name();
                #[cfg(windows)]
                let name = name.to_ascii_lowercase();
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
