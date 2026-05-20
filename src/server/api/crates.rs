//! Batch crate metadata lookup. Reuses the standard HTTP proxy cache
//! (with synthesized 24h TTL for crates.io URLs — see
//! [`crate::server::proxy::synth_max_age_for`]).
//!
//! Two outcomes per requested name:
//! - **Cache hit** (fresh or stale): parsed and returned inline in `results`.
//!   Stale entries are served immediately and revalidated in background by
//!   the proxy's stale-while-revalidate machinery.
//! - **Cache miss**: a warming task is spawned (deduped via
//!   `state.revalidating`) and the name is returned in `pending`. The
//!   frontend retries with the same name; once the warming task has
//!   populated the cache, the subsequent peek hits and the name moves into
//!   `results`.
//!
//! `?refresh=true` skips the peek and always spawns a warming task, so the
//! cached body is replaced even if currently fresh.

use std::collections::HashMap;
use std::sync::Arc;

use dashmap::DashSet;
use serde::Deserialize;

use crate::server::crates_metadata;
use crate::server::crates_metadata::CrateMetadata;
use crate::server::proxy;
use crate::server::proxy::FetchOpts;
use crate::server::state::AppState;

#[derive(Deserialize)]
pub struct RequestBody {
    pub names: Vec<String>,
}

/// `POST /api/v1/crates[?refresh=true]` — batch lookup. See module docs.
///
/// Returns `200` with `{results, pending}`. Returns `400` for malformed body
/// or `?refresh=true` with more than one name (guards against accidental
/// bulk hits against crates.io).
pub async fn post(state: &AppState, query: &str, body: &[u8]) -> http::Response<Vec<u8>> {
    let refresh = parse_refresh(query);
    let request: RequestBody =
        match serde_json::from_slice(body) {
            Ok(r) => r,
            Err(err) => return json_error(400, format!("invalid request body: {err}")),
        };
    if refresh && request.names.len() > 1 {
        return json_error(400, "?refresh=true only supports a single crate".into());
    }

    let mut results: HashMap<String, Option<CrateMetadata>> = HashMap::new();
    let mut pending: Vec<String> = Vec::new();

    for name in request.names {
        let url = format!("https://crates.io/api/v1/crates/{name}");

        // refresh=true: bypass peek entirely; always spawn warming. The
        // client retries with the same name until the cache is populated.
        if refresh {
            spawn_warming_task(state, name.clone(), url);
            pending.push(name);
            continue;
        }

        match proxy::peek(state, &url).await {
            Some(response) => {
                // Parse the cached body. If parsing fails, surface as
                // `null` (no retry — parse errors don't fix themselves).
                let parsed = crates_metadata::parse_metadata(&name, response.body());
                results.insert(name, parsed);
            },
            None => {
                spawn_warming_task(state, name.clone(), url);
                pending.push(name);
            },
        }
    }

    json_ok(serde_json::json!({ "results": results, "pending": pending }))
}

/// Spawn a tokio task that calls `proxy::fetch` to populate the cache for
/// `url`. Deduped via `state.revalidating` so concurrent requests for the
/// same name don't trigger parallel upstream hits.
fn spawn_warming_task(state: &AppState, name: String, url: String) {
    if !state.revalidating.insert(url.clone()) {
        // Another task is already fetching this URL — let it complete.
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let _guard = ClearOnDrop {
            set: Arc::clone(&state.revalidating),
            url: url.clone(),
        };
        // force_refresh: true so a refresh=true caller actually re-fetches
        // even if the cache currently holds a fresh entry. For the normal
        // miss path this is a no-op (cache lookup would have missed anyway).
        let opts = FetchOpts { force_refresh: true };
        match proxy::fetch(&state, &url, opts).await {
            Ok(_) => log::info!("[crates] warmed cache for {name}"),
            Err(err) => log::warn!("[crates] cache warming failed for {name}: {err:#}"),
        }
    });
}

/// Clears the URL from the dedup set on drop (including on panic).
struct ClearOnDrop {
    set: Arc<DashSet<String>>,
    url: String,
}

impl Drop for ClearOnDrop {
    fn drop(&mut self) { self.set.remove(&self.url); }
}

/// Parse `?refresh=true` from a raw query string. Any other value (or
/// absence) is treated as `false`.
fn parse_refresh(query: &str) -> bool {
    query.split('&').any(|pair| pair == "refresh=true")
}

fn json_ok(value: serde_json::Value) -> http::Response<Vec<u8>> {
    let body = serde_json::to_vec(&value).expect("serialize json response");
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
