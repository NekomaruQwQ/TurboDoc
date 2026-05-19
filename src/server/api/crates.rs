//! Batch crate metadata lookup against crates.io with caching + stale
//! fallback.
//!
//! Two-phase flow (matches the former Hono handler):
//! - **Phase 1**: scan the cache. Fresh entries are returned immediately.
//!   Stale entries are remembered as a fallback for phase 2.
//! - **Phase 2**: fetch missing/stale crates from crates.io in parallel. On
//!   network errors or non-2xx responses, the stale fallback (if any) is
//!   served — bad data is better than no data for a docs viewer.
//!
//! `?refresh=true` bypasses phase 1 entirely. It is limited to a single
//! crate to prevent accidental bulk hits against crates.io.

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::Value;

use crate::server::crates_cache;
use crate::server::crates_cache::CrateMetadata;
use crate::server::state::AppState;

#[derive(Deserialize)]
pub struct RequestBody {
    pub names: Vec<String>,
}

#[derive(Deserialize)]
pub struct RefreshQuery {
    #[serde(default)]
    pub refresh: Option<String>,
}

impl RefreshQuery {
    fn is_set(&self) -> bool { self.refresh.as_deref() == Some("true") }
}

pub async fn post_crates(
    State(state): State<AppState>,
    Query(query): Query<RefreshQuery>,
    Json(body): Json<RequestBody>,
) -> Result<Json<HashMap<String, Option<CrateMetadata>>>, (StatusCode, Json<Value>)> {
    let refresh = query.is_set();
    if refresh && body.names.len() > 1 {
        Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "?refresh=true only supports a single crate" }))))?;
    }

    // Phase 1: scan cache. Fresh hits go straight into `results`; stale or
    // missing entries get queued for phase 2 (with the stale body saved as a
    // fallback if upstream fails).
    let mut results: HashMap<String, Option<CrateMetadata>> = HashMap::new();
    let mut stale_fallbacks: HashMap<String, Vec<u8>> = HashMap::new();
    let mut to_fetch: Vec<String> = Vec::new();

    for name in &body.names {
        let cached = crates_cache::get(&state.db, name).await;
        match cached {
            Some(c) if !refresh && c.fresh => {
                results.insert(name.clone(), crates_cache::parse_metadata(name, &c.body));
            },
            Some(c) => {
                stale_fallbacks.insert(name.clone(), c.body);
                to_fetch.push(name.clone());
            },
            None => to_fetch.push(name.clone()),
        }
    }

    // Phase 2: fetch in parallel. Each task either updates the cache + result,
    // or falls back to the stale body (if any) on failure.
    let mut set = tokio::task::JoinSet::new();
    for name in to_fetch {
        let state = state.clone();
        let stale = stale_fallbacks.remove(&name);
        set.spawn(async move {
            let outcome = crates_cache::fetch_upstream(&state.http_client, &name).await;
            let metadata = match outcome {
                Ok(Some(body)) => {
                    let parsed = crates_cache::parse_metadata(&name, &body);
                    crates_cache::set(&state.db, &name, body).await;
                    parsed
                },
                Ok(None) | Err(_) =>
                    stale.as_deref().and_then(|b| crates_cache::parse_metadata(&name, b)),
            };
            (name, metadata)
        });
    }
    while let Some(joined) = set.join_next().await {
        match joined {
            Ok((name, metadata)) => { results.insert(name, metadata); },
            Err(err) => log::error!("crates fetch task panicked: {err}"),
        }
    }

    Ok(Json(results))
}
