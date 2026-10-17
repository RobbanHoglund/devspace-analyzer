use super::*;

const MAX_DIRECTORIES: usize = 10_000;
const MAX_DETAIL_BYTES: usize = 4 * 1024 * 1024;
const MAX_FILES_PER_DIRECTORY: usize = 5;

pub(super) struct Checkpoint { index: Option<usize>, bytes: u64, files: u64, warnings: u64, classified: u64 }

impl<F: FnMut(Progress)> Scanner<'_, F> {
    pub(super) fn enter_directory(&mut self, path: &Path) -> Checkpoint {
        let parent = self.storage_stack.last().copied().flatten();
        let root = self.storage_stack.is_empty();
        let cost = display(path).len() * 2 + 256;
        // Reserve roots even after the detail budget is reached. Descendants of
        // omitted directories must not reappear as misleading, orphaned roots.
        let retain = root || (parent.is_some() && self.report.storage.directories.len() < MAX_DIRECTORIES && self.storage_bytes + cost <= MAX_DETAIL_BYTES);
        let index = if retain {
            let index = self.report.storage.directories.len();
            self.report.storage.directories.push(StorageDirectory {
                id: index, parent_id: parent, path: display(path), logical_bytes: 0, files: 0,
                classified_bytes: 0, direct_classified_bytes: 0, direct_file_bytes: 0, direct_files: 0, largest_files: vec![], complete: false, omitted_directories: 0,
            });
            self.storage_bytes += cost;
            Some(index)
        } else {
            self.report.storage.truncated = true;
            if let Some(parent) = parent { self.report.storage.directories[parent].omitted_directories += 1; }
            None
        };
        self.storage_stack.push(index);
        Checkpoint { index, bytes: self.report.progress.logical_bytes, files: self.report.progress.files, warnings: self.report.warning_count, classified: self.classified_bytes }
    }
    pub(super) fn leave_directory(&mut self, checkpoint: Checkpoint) {
        self.storage_stack.pop();
        let complete = !self.halted() && self.report.warning_count == checkpoint.warnings;
        if let Some(index) = checkpoint.index {
            let node = &mut self.report.storage.directories[index];
            node.logical_bytes = self.report.progress.logical_bytes.saturating_sub(checkpoint.bytes);
            node.files = self.report.progress.files.saturating_sub(checkpoint.files);
            node.complete = complete;
            node.classified_bytes = self.classified_bytes.saturating_sub(checkpoint.classified);
        }
    }
    pub(super) fn retain_file(&mut self, path: &Path, bytes: u64, classified: bool) {
        let Some(index) = self.storage_stack.last().copied().flatten() else { return; };
        let node = &mut self.report.storage.directories[index];
        node.direct_files += 1;
        if classified { node.direct_classified_bytes = node.direct_classified_bytes.saturating_add(bytes); }
        node.direct_file_bytes = node.direct_file_bytes.saturating_add(bytes);
        // Avoid allocating a filename for every small file in a large directory.
        let smallest = (node.largest_files.len() == MAX_FILES_PER_DIRECTORY).then(|| node.largest_files.last().unwrap());
        if smallest.is_some_and(|file| bytes < file.logical_bytes) { return; }
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if smallest.is_some_and(|file| bytes == file.logical_bytes && name >= file.name) { return; }
        let cost = name.len() * 2 + 80;
        let replaced_cost = smallest.map_or(0, |file| file.name.len() * 2 + 80);
        if self.storage_bytes - replaced_cost + cost > MAX_DETAIL_BYTES {
            self.report.storage.truncated = true;
            return;
        }
        if replaced_cost > 0 { node.largest_files.pop(); self.storage_bytes -= replaced_cost; }
        node.largest_files.push(StorageFile { name, logical_bytes: bytes });
        self.storage_bytes += cost;
        node.largest_files.sort_by(|a, b| b.logical_bytes.cmp(&a.logical_bytes).then_with(|| a.name.cmp(&b.name)));
    }
}
