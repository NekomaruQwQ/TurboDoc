//! Provider data persistence: `${dataDir}/{file_name}.toml`.
//!
//! Each provider stores its workspace state (items, groups, pinned pages,
//! …) as a TOML file. The frontend speaks JSON, so this module converts
//! between the two on every read and write.
//!
//! TOML has no `null`. The former Bun server inherited the same constraint
//! from `smol-toml` — the data shapes the frontend produces don't include
//! nulls today, so we match that behavior (TOML serialization errors out
//! rather than silently dropping fields).

use std::path::PathBuf;

use serde_json::Value;

use crate::server::state::AppState;

/// Build the absolute path for `<file_name>.toml`. The route parameter is a
/// single URL segment, so it can't contain `/` — no traversal possible.
fn path_for(state: &AppState, file_name: &str) -> PathBuf {
    state.data_dir.join(format!("{file_name}.toml"))
}

/// `GET /api/v1/data/{file_name}` — read TOML, return as JSON.
///
/// Missing file → `200 {}` (a fresh install has no provider data yet).
/// Other I/O or parse errors → `500`.
pub async fn get(state: &AppState, file_name: &str) -> http::Response<Vec<u8>> {
    let path = path_for(state, file_name);
    let text =
        match tokio::fs::read_to_string(&path).await {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound =>
                return json_ok(&Value::Object(Default::default())),
            Err(err) =>
                return json_error(500, format!("read failed: {err}")),
        };
    let toml_value: toml::Value =
        match toml::from_str(&text) {
            Ok(v) => v,
            Err(err) => return json_error(500, format!("parse failed: {err}")),
        };
    let json_value: Value =
        match serde_json::to_value(toml_value) {
            Ok(v) => v,
            Err(err) => return json_error(500, format!("convert failed: {err}")),
        };
    json_ok(&json_value)
}

/// `PUT /api/v1/data/{file_name}` — write JSON as TOML.
///
/// Body must be a JSON object (matches the former `zValidator("json",
/// z.object())` schema). Non-object bodies → `400`.
pub async fn put(state: &AppState, file_name: &str, body: &[u8]) -> http::Response<Vec<u8>> {
    let parsed: Value =
        match serde_json::from_slice(body) {
            Ok(v) => v,
            Err(err) => return json_error(400, format!("invalid json: {err}")),
        };
    if !parsed.is_object() {
        return json_error(400, "body must be a JSON object".into());
    }
    let toml_text =
        match toml::to_string(&parsed) {
            Ok(t) => t,
            Err(err) => return json_error(500, format!("serialize failed: {err}")),
        };
    let path = path_for(state, file_name);
    if let Err(err) = tokio::fs::write(&path, toml_text).await {
        return json_error(500, format!("write failed: {err}"));
    }
    json_ok(&serde_json::json!({ "success": true }))
}

fn json_ok(value: &Value) -> http::Response<Vec<u8>> {
    let body = serde_json::to_vec(value).expect("serialize json response");
    http::Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(body)
        .expect("valid response")
}

fn json_error(status: u16, message: String) -> http::Response<Vec<u8>> {
    let body =
        serde_json::to_vec(&serde_json::json!({ "error": message }))
            .expect("serialize json error");
    http::Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(body)
        .expect("valid response")
}
