//! Stale-while-revalidate: refresh stale cache entries in the background so
//! the caller never blocks on upstream when there's still a cached body to
//! serve.
//!
//! Dedup: `AppState::revalidating` is a `DashSet<String>` keyed by URL.
//! `DashSet::insert` returns `false` when an entry already exists, so we
//! only spawn one task per URL even if multiple requests hit a stale entry
//! simultaneously. A `Drop` guard makes sure the URL is cleared even if the
//! task panics — otherwise a panicked refetch would leave the URL stuck
//! "in flight" forever.

use std::sync::Arc;
use std::time::SystemTime;

use dashmap::DashSet;
use http_cache_semantics::AfterResponse;
use http_cache_semantics::BeforeRequest;

use crate::server::proxy::cache;
use crate::server::proxy::cache::CacheEntry;
use crate::server::state::AppState;

/// Spawn a background refetch for `url` using `cached.policy` to determine
/// freshness. No-op if a refetch for the same URL is already in flight.
pub fn enqueue(state: AppState, url: String, cached: CacheEntry) {
    if !state.revalidating.insert(url.clone()) {
        return;
    }
    tokio::spawn(async move {
        let _guard = ClearOnDrop {
            revalidating: Arc::clone(&state.revalidating),
            url: url.clone(),
        };
        if let Err(err) = revalidate(&state, &url, cached).await {
            log::error!("[proxy] background revalidation failed for {url}: {err}");
        }
    });
}

async fn revalidate(
    state: &AppState,
    url: &str,
    cached: CacheEntry,
) -> anyhow::Result<()> {
    let synth_req =
        http::Request::builder()
            .method("GET")
            .uri(url)
            .body(())?;

    // `before_request` decides whether we still need to revalidate (it might
    // have re-freshened in the brief gap between handler and task). If
    // it's still stale, it hands us a `Parts` with the right conditional
    // headers (If-None-Match, If-Modified-Since) already filled in.
    let stale_req =
        match cached.policy.before_request(&synth_req, SystemTime::now()) {
            BeforeRequest::Fresh(_) => return Ok(()),
            BeforeRequest::Stale { request, .. } => request,
        };

    let mut req_builder = state.http_client.get(url);
    for (name, value) in stale_req.headers.iter() {
        req_builder = req_builder.header(name.as_str(), value);
    }
    let response = req_builder.send().await?;
    let http_resp = crate::server::proxy::http_response_from_reqwest(&response);

    match cached.policy.after_response(&synth_req, &http_resp, SystemTime::now()) {
        AfterResponse::NotModified(new_policy, _) => {
            log::info!("[proxy] REVALIDATED (304, background) {url}");
            cache::set(&state.db, url, CacheEntry { policy: new_policy, ..cached }).await?;
        },
        AfterResponse::Modified(new_policy, _) => {
            log::info!("[proxy] REVALIDATED (new response, background) {url}");
            let status = response.status().as_u16();
            let content_type =
                response.headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_owned();
            let location =
                response.headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_owned();
            let is_redirect = (300..400).contains(&status);
            let body =
                if is_redirect { None } else { Some(response.bytes().await?.to_vec()) };
            if new_policy.is_storable() && (status == 200 || is_redirect) {
                cache::set(&state.db, url, CacheEntry {
                    policy: new_policy,
                    status_code: status,
                    content_type,
                    location,
                    body,
                }).await?;
            }
        },
    }
    Ok(())
}

/// Removes `url` from `revalidating` when dropped. Runs even on panic, so
/// a buggy revalidator can't permanently jam the dedup set.
struct ClearOnDrop {
    revalidating: Arc<DashSet<String>>,
    url: String,
}

impl Drop for ClearOnDrop {
    fn drop(&mut self) { self.revalidating.remove(&self.url); }
}
