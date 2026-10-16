use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanRequest {
    pub roots: Vec<String>,
    pub include_global_caches: bool,
    /// Existing local directories; rejected entries produce coverage warnings.
    pub protected_paths: Vec<String>,
}
impl Default for ScanRequest {
    fn default() -> Self {
        Self { roots: vec![], include_global_caches: true, protected_paths: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub path: String,
    pub label: String,
    pub ecosystem: String,
    pub kind: String,
    pub risk: String,
    pub confidence: String,
    pub logical_bytes: u64,
    pub files: u64,
    pub latest_modified: Option<u64>,
    pub project_id: Option<String>,
    pub evidence: Vec<String>,
    pub reason: String,
    pub recovery: String,
    pub caveats: Vec<String>,
    pub complete: bool,
    pub user_protected: bool,
    pub wrapper_version: Option<String>,
    pub wrapper_references: Vec<String>,
    #[serde(default)]
    pub protected_descendants: Vec<ProtectedLocation>,
    #[serde(default)]
    pub protected_descendant_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedLocation { pub path: String, pub label: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub ecosystems: Vec<String>,
    pub markers: Vec<String>,
    pub lockfiles: Vec<String>,
    pub git_kind: Option<String>,
    pub branch: Option<String>,
    pub wrapper_version: Option<String>,
    pub workspace: bool,
    /// Metadata from outside the selected roots; byte totals remain in-scope only.
    #[serde(default)]
    pub context_only: bool,
    pub owned_logical_bytes: u64,
    pub artifact_bytes: u64,
    #[serde(default)]
    pub recovery_evidence: Option<RecoveryEvidence>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEvidence {
    pub wrappers: Vec<String>,
    pub node_manifest: String,
    pub package_manager: Option<String>,
    pub scripts: Vec<String>,
    pub local_dependencies: Vec<String>,
    pub local_dependency_count: usize,
    pub install_scripts: bool,
    pub patches: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInventory {
    pub directories: Vec<StorageDirectory>,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDirectory {
    pub id: usize,
    pub parent_id: Option<usize>,
    pub path: String,
    pub logical_bytes: u64,
    pub files: u64,
    pub classified_bytes: u64,
    pub direct_classified_bytes: u64,
    pub direct_file_bytes: u64,
    pub direct_files: u64,
    pub largest_files: Vec<StorageFile>,
    pub complete: bool,
    pub omitted_directories: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFile { pub name: String, pub logical_bytes: u64 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files: u64,
    pub directories: u64,
    pub logical_bytes: u64,
    pub projects: usize,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning { pub path: String, pub code: String, pub message: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheLocation {
    pub path: String,
    pub ecosystem: String,
    pub kind: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub schema_version: u32,
    pub started_at: u64,
    pub duration_ms: u64,
    pub roots: Vec<String>,
    pub global_caches: Vec<CacheLocation>,
    pub findings: Vec<Finding>,
    pub projects: Vec<Project>,
    pub progress: Progress,
    pub warnings: Vec<ScanWarning>,
    pub warning_count: u64,
    pub complete: bool,
    pub cancelled: bool,
    pub size_basis: String,
    pub limitations: Vec<String>,
    #[serde(default)]
    pub storage: StorageInventory,
}
