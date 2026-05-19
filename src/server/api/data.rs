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

use axum::Json;
use axum::extract::Path;
use axum::extract::State;
use axum::http::StatusCode;
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
pub async fn get_data(
    State(state): State<AppState>,
    Path(file_name): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let path = path_for(&state, &file_name);
    let text =
        match tokio::fs::read_to_string(&path).await {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound =>
                return Ok(Json(Value::Object(Default::default()))),
            Err(err) =>
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("read failed: {err}"))),
        };
    let toml_value: toml::Value =
        toml::from_str(&text)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("parse failed: {err}")))?;
    let json_value: Value =
        serde_json::to_value(toml_value)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("convert failed: {err}")))?;
    Ok(Json(json_value))
}

/// `PUT /api/v1/data/{file_name}` — write JSON as TOML.
///
/// Body must be a JSON object (matches the former `zValidator("json",
/// z.object())` schema). Non-object bodies → `400`.
pub async fn put_data(
    State(state): State<AppState>,
    Path(file_name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if !body.is_object() {
        Err((StatusCode::BAD_REQUEST, "body must be a JSON object".into()))?;
    }
    let toml_text =
        toml::to_string(&body)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("serialize failed: {err}")))?;
    let path = path_for(&state, &file_name);
    tokio::fs::write(&path, toml_text)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("write failed: {err}")))?;
    Ok(Json(serde_json::json!({ "success": true })))
}
