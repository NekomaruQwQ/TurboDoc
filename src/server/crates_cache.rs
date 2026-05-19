//! Dedicated cache for crates.io API responses.
//!
//! Stores raw upstream response bodies with a 24-hour time-based TTL.
//! No LRU eviction — crate metadata is small (~10–50 KB per entry) and
//! bounded by the number of crates the user tracks.
//!
//! On upstream failure, stale entries are served rather than returning
//! null — crate metadata doesn't change retroactively, so stale data is
//! better than no data.

use std::sync::Arc;

use serde::Deserialize;
use serde::Serialize;

use crate::server::USER_AGENT;
use crate::server::db::Database;

/// 24 hours. Crate metadata changes infrequently, and version publishes
/// aren't time-critical for a documentation viewer.
const MAX_AGE_SECONDS: i64 = 86400;

/// Normalized crate metadata returned by `POST /crates`. Flattened from the
/// nested crates.io response shape — the frontend never sees the raw upstream
/// format.
#[derive(Serialize)]
pub struct CrateMetadata {
    pub name: String,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub documentation: Option<String>,
    pub versions: Vec<CrateVersion>,
}

#[derive(Serialize)]
pub struct CrateVersion {
    pub num: String,
    pub yanked: bool,
}

/// A cached crate entry: the raw upstream body plus a freshness flag. Callers
/// decide whether to refresh or fall back based on `fresh`.
pub struct CachedCrate {
    pub body: Vec<u8>,
    pub fresh: bool,
}

/// Look up a cached crate response. Returns `None` on cache miss.
pub async fn get(db: &Arc<Database>, name: &str) -> Option<CachedCrate> {
    let name = name.to_owned();
    db.query(move |conn| {
        let mut stmt =
            conn.prepare_cached("SELECT body, fetched_at FROM crates_cache WHERE name = ?")
                .ok()?;
        let row =
            stmt.query_row([&name], |row| {
                Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, i64>(1)?))
            })
            .ok()?;
        let (body, fetched_at) = row;
        let now = now_secs();
        let age = now - fetched_at;
        Some(CachedCrate { body, fresh: age < MAX_AGE_SECONDS })
    }).await
}

/// Store a raw crates.io response body. Overwrites any existing entry.
pub async fn set(db: &Arc<Database>, name: &str, body: Vec<u8>) {
    let name = name.to_owned();
    db.query(move |conn| {
        let now = now_secs();
        let mut stmt =
            conn.prepare_cached(
                "INSERT OR REPLACE INTO crates_cache (name, body, fetched_at) \
                 VALUES (?1, ?2, ?3)")
                .expect("prepare crates_cache upsert");
        let _ = stmt.execute(rusqlite::params![&name, &body, now])
            .inspect_err(|err| log::warn!("crates_cache upsert failed for {name}: {err}"));
    }).await
}

/// Fetch a crate's metadata from crates.io. Returns `Ok(Some(body))` on HTTP
/// 200, `Ok(None)` on any non-200 (so callers can fall back to a stale
/// cache), and `Err(...)` on network errors.
pub async fn fetch_upstream(client: &reqwest::Client, name: &str) -> reqwest::Result<Option<Vec<u8>>> {
    let url = format!("https://crates.io/api/v1/crates/{name}");
    let response =
        client
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .send()
            .await?;
    if !response.status().is_success() {
        return Ok(None);
    }
    Ok(Some(response.bytes().await?.to_vec()))
}

/// Parse a raw crates.io response body into normalized `CrateMetadata`.
/// Returns `None` if the body is malformed or missing required fields.
pub fn parse_metadata(name: &str, body: &[u8]) -> Option<CrateMetadata> {
    let parsed: UpstreamResponse =
        serde_json::from_slice(body)
            .inspect_err(|err| log::warn!("[crates] failed to parse metadata for {name}: {err}"))
            .ok()?;
    let crate_info = parsed.crate_?;
    Some(CrateMetadata {
        name: crate_info.name,
        description: crate_info.description,
        homepage: crate_info.homepage,
        repository: crate_info.repository,
        documentation: crate_info.documentation,
        versions:
            parsed.versions
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| Some(CrateVersion { num: v.num?, yanked: v.yanked.unwrap_or(false) }))
                .collect(),
    })
}

#[inline]
fn now_secs() -> i64 {
    use std::time::SystemTime;
    use std::time::UNIX_EPOCH;
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// -- Upstream response shape --

#[derive(Deserialize)]
struct UpstreamResponse {
    #[serde(rename = "crate")]
    crate_: Option<UpstreamCrate>,
    versions: Option<Vec<UpstreamVersion>>,
}

#[derive(Deserialize)]
struct UpstreamCrate {
    name: String,
    description: Option<String>,
    homepage: Option<String>,
    repository: Option<String>,
    documentation: Option<String>,
}

#[derive(Deserialize)]
struct UpstreamVersion {
    num: Option<String>,
    yanked: Option<bool>,
}
