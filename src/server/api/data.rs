//! JSON-over-HTTP persistence backed by TOML files.
//!
//! Generic application resources live at `${dataDir}/{data_id}.toml`.
//! Independently compiled sources live at
//! `${dataDir}/sources/{source_id}.toml`. The dispatcher validates every ID
//! before this module maps it to the filesystem.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::server::state::AppState;

/// Response metadata distinguishing a genuinely missing file from valid `{}`.
const RESOURCE_EXISTS_HEADER: &str = "x-turbodoc-resource-exists";

/// Persistence namespace selected by the API route.
#[derive(Clone, Copy)]
enum DataLocation {
    /// Root-level generic application data.
    Root,
    /// Per-source data under the dedicated `sources` directory.
    Sources,
}

/// `GET /api/data/{data_id}` — read one root-level TOML resource as JSON.
pub async fn get_data(state: &AppState, data_id: &str) -> http::Response<Vec<u8>> {
    get(state, data_id, DataLocation::Root).await
}

/// `PUT /api/data/{data_id}` — replace one root-level TOML resource.
pub async fn put_data(
    state: &AppState,
    data_id: &str,
    body: &[u8]) -> http::Response<Vec<u8>> {
    put(state, data_id, body, DataLocation::Root).await
}

/// `GET /api/sources/{source_id}` — read one per-source TOML resource as JSON.
pub async fn get_source(state: &AppState, source_id: &str) -> http::Response<Vec<u8>> {
    get(state, source_id, DataLocation::Sources).await
}

/// `PUT /api/sources/{source_id}` — replace one per-source TOML resource.
///
/// The `sources` directory is created lazily so reading a fresh workspace has
/// no filesystem side effects.
pub async fn put_source(
    state: &AppState,
    source_id: &str,
    body: &[u8]) -> http::Response<Vec<u8>> {
    put(state, source_id, body, DataLocation::Sources).await
}

/// Build the validated resource's absolute TOML path.
fn path_for(state: &AppState, resource_id: &str, location: DataLocation) -> PathBuf {
    match location {
        DataLocation::Root => state.data_dir.join(format!("{resource_id}.toml")),
        DataLocation::Sources =>
            state.data_dir.join("sources").join(format!("{resource_id}.toml")),
    }
}

/// Read TOML and return its JSON representation.
///
/// A missing file is `200 {}` with an explicit false existence header. Other
/// I/O, parsing, or conversion failures return `500` and never substitute an
/// empty value that could later overwrite the unreadable file.
async fn get(
    state: &AppState,
    resource_id: &str,
    location: DataLocation) -> http::Response<Vec<u8>> {
    let path = path_for(state, resource_id, location);
    get_path(&path).await
}

/// Read one already validated persistence path without changing the filesystem.
async fn get_path(path: &Path) -> http::Response<Vec<u8>> {
    let text = match tokio::fs::read_to_string(path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound =>
            return json_ok(&Value::Object(Default::default()), false),
        Err(err) => return json_error(500, format!("read failed: {err}")),
    };
    let toml_value: toml::Value = match toml::from_str(&text) {
        Ok(value) => value,
        Err(err) => return json_error(500, format!("parse failed: {err}")),
    };
    let json_value = match serde_json::to_value(toml_value) {
        Ok(value) => value,
        Err(err) => return json_error(500, format!("convert failed: {err}")),
    };
    json_ok(&json_value, true)
}

/// Parse a JSON object, convert it to TOML, and replace one resource.
///
/// JSON syntax and non-object bodies return `400`. Source-directory creation,
/// TOML serialization, and write failures return `500`.
async fn put(
    state: &AppState,
    resource_id: &str,
    body: &[u8],
    location: DataLocation) -> http::Response<Vec<u8>> {
    let parsed: Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(err) => return json_error(400, format!("invalid json: {err}")),
    };
    if !parsed.is_object() {
        return json_error(400, "body must be a JSON object".into());
    }
    let toml_text = match toml::to_string(&parsed) {
        Ok(text) => text,
        Err(err) => return json_error(500, format!("serialize failed: {err}")),
    };
    if matches!(location, DataLocation::Sources) {
        let sources_dir = state.data_dir.join("sources");
        if let Err(err) = tokio::fs::create_dir_all(&sources_dir).await {
            return json_error(500, format!("create sources directory failed: {err}"));
        }
    }
    let path = path_for(state, resource_id, location);
    put_path(&path, toml_text).await
}

/// Replace one already validated persistence path with serialized TOML.
async fn put_path(path: &Path, toml_text: String) -> http::Response<Vec<u8>> {
    if let Err(err) = tokio::fs::write(path, toml_text).await {
        return json_error(500, format!("write failed: {err}"));
    }
    json_ok(&serde_json::json!({ "success": true }), true)
}

/// Build a successful JSON response with resource-existence metadata.
fn json_ok(value: &Value, exists: bool) -> http::Response<Vec<u8>> {
    let body = serde_json::to_vec(value).expect("JSON values should serialize");
    http::Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .header(RESOURCE_EXISTS_HEADER, exists.to_string())
        .body(body)
        .expect("static response fields should be valid")
}

/// Build a JSON error response without panicking on user-controlled data.
fn json_error(status: u16, message: String) -> http::Response<Vec<u8>> {
    let body = serde_json::to_vec(&serde_json::json!({ "error": message }))
        .expect("JSON error values should serialize");
    http::Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(body)
        .expect("static response fields should be valid")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{get_path, put_path, DataLocation, RESOURCE_EXISTS_HEADER};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    /// Unique process-local temporary directory removed after each test.
    struct TestDirectory {
        /// Resolved path below the operating system's temporary directory.
        path: PathBuf,
    }

    impl TestDirectory {
        /// Create an isolated directory without adding a production dependency.
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "turbodoc-data-test-{}-{}",
                std::process::id(),
                NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self { path }
        }
    }

    impl Drop for TestDirectory {
        /// Remove only the uniquely named child created by [`Self::new`].
        fn drop(&mut self) {
            let temporary_root = std::env::temp_dir();
            let safe_child = self.path.parent() == Some(temporary_root.as_path()) &&
                self.path.file_name().is_some_and(|name|
                    name.to_string_lossy().starts_with("turbodoc-data-test-"));
            if !safe_child { return; }
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    /// Mirror `path_for` without constructing unrelated server state.
    fn relative_path(resource_id: &str, location: DataLocation) -> PathBuf {
        match location {
            DataLocation::Root => Path::new("").join(format!("{resource_id}.toml")),
            DataLocation::Sources =>
                Path::new("sources").join(format!("{resource_id}.toml")),
        }
    }

    #[test]
    fn source_resources_live_under_dedicated_directory() {
        assert_eq!(
            relative_path("rust-crates", DataLocation::Sources),
            PathBuf::from("sources").join("rust-crates.toml"));
    }

    #[test]
    fn explorer_workspace_resource_remains_at_root() {
        assert_eq!(
            relative_path("ui.explorer", DataLocation::Root),
            PathBuf::from("ui.explorer.toml"));
    }

    #[tokio::test]
    async fn missing_and_existing_resources_have_distinct_metadata() {
        let directory = TestDirectory::new();
        let path = directory.path.join("source.toml");

        let missing = get_path(&path).await;
        assert_eq!(
            (
                missing.status(),
                missing.headers()[RESOURCE_EXISTS_HEADER]
                    .to_str().expect("existence metadata should be text"),
                missing.body().as_slice()),
            (http::StatusCode::OK, "false", b"{}".as_slice()));

        let written = put_path(
            &path,
            "schemaVersion = 1\npinnedPages = []\n".to_owned()).await;
        assert_eq!(written.status(), http::StatusCode::OK);

        let existing = get_path(&path).await;
        assert_eq!(
            (
                existing.status(),
                existing.headers()[RESOURCE_EXISTS_HEADER]
                    .to_str().expect("existence metadata should be text")),
            (http::StatusCode::OK, "true"));
        let json: serde_json::Value = serde_json::from_slice(existing.body())
            .expect("existing TOML should return JSON");
        assert_eq!(json, serde_json::json!({
            "schemaVersion": 1,
            "pinnedPages": [],
        }));
    }

    #[tokio::test]
    async fn malformed_toml_returns_error_without_modifying_the_file() {
        let directory = TestDirectory::new();
        let path = directory.path.join("source.toml");
        let malformed = "[unterminated";
        tokio::fs::write(&path, malformed).await
            .expect("malformed test input should be written");

        let response = get_path(&path).await;

        assert_eq!(response.status(), http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            tokio::fs::read_to_string(&path).await
                .expect("malformed file should remain readable"),
            malformed);
    }
}
