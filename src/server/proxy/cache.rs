//! SQLite-backed HTTP response cache with LRU eviction.
//!
//! Stores `(policy, status, response_headers, body)` per URL plus a
//! `last_accessed` timestamp used for eviction. Clean upstream responses only
//! — dark-mode injection and final synthesized headers happen at serve time.
//!
//! The policy is serialized via the `http-cache-semantics` crate's serde
//! feature. The former Bun server used the JS library's `toObject()` JSON,
//! which has a different shape — the first read of a TS-populated DB row
//! will fail to deserialize, drop the row, and re-fetch on the next access.

use std::sync::Arc;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use http::HeaderMap;
use http::HeaderName;
use http::HeaderValue;
use http_cache_semantics::CachePolicy;

use crate::server::db::Database;

/// Maximum number of cached responses before LRU eviction kicks in.
const MAX_HTTP_CACHE_ENTRIES: i64 = 2000;

/// A cached HTTP response and its associated policy.
pub struct CacheEntry {
    pub policy: CachePolicy,
    pub status_code: u16,
    pub content_type: String,
    pub location: String,
    /// Allowed upstream-derived fields. Final length, CORS, and stale
    /// overrides are rebuilt for every WebView2 response.
    pub response_headers: HeaderMap,
    pub body: Option<Vec<u8>>,
}

/// Look up `url`. On hit, also touches `last_accessed` (LRU tracking) and
/// drops the row + returns `None` if the stored policy can no longer be
/// deserialized (e.g. legacy JSON from the Bun server, schema drift).
pub async fn get(db: &Arc<Database>, url: &str) -> Option<CacheEntry> {
    let url = url.to_owned();
    db.query(move |conn| {
        let row =
            conn.query_row(
                "SELECT policy, status_code, content_type, location, response_headers, body \
                 FROM http_cache WHERE url = ?",
                [&url],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<Vec<u8>>>(5)?)))
                .ok()?;
        let (
            policy_json,
            status_code,
            content_type,
            location,
            response_headers_json,
            body) = row;

        let policy: CachePolicy =
            match serde_json::from_str(&policy_json) {
                Ok(p) => p,
                Err(err) => {
                    log::warn!("[proxy] dropping cache entry with unreadable policy ({url}): {err}");
                    let _ = conn.execute("DELETE FROM http_cache WHERE url = ?", [&url]);
                    return None;
                },
            };
        let response_headers =
            match deserialize_response_headers(&response_headers_json) {
                Ok(headers) if !headers.is_empty() => headers,
                Ok(_) => legacy_response_headers(&content_type, &location),
                Err(err) => {
                    log::warn!(
                        "[proxy] using legacy headers for cache entry with unreadable \
                         response_headers ({url}): {err}");
                    legacy_response_headers(&content_type, &location)
                },
            };

        let now = now_secs();
        let _ = conn.execute(
            "UPDATE http_cache SET last_accessed = ?2 WHERE url = ?1",
            rusqlite::params![&url, now]);

        Some(CacheEntry {
            policy,
            status_code: status_code as u16,
            content_type,
            location,
            response_headers,
            body,
        })
    }).await
}

/// Store an entry. If the cache is at capacity *and* this is a fresh URL,
/// evicts the least-recently-accessed entry first. Existing URLs are
/// replaced via `INSERT OR REPLACE` and don't trigger eviction.
pub async fn set(db: &Arc<Database>, url: &str, entry: CacheEntry) -> anyhow::Result<()> {
    let url = url.to_owned();
    let policy_json = serde_json::to_string(&entry.policy)?;
    let response_headers_json = serialize_response_headers(&entry.response_headers)?;
    let CacheEntry { status_code, content_type, location, body, .. } = entry;

    db.query(move |conn| -> rusqlite::Result<()> {
        // Only count toward capacity if we're actually inserting a new row.
        let exists: bool =
            conn.query_row("SELECT 1 FROM http_cache WHERE url = ?", [&url], |_| Ok(true))
                .unwrap_or(false);
        if !exists {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM http_cache", [], |row| row.get(0))?;
            if count >= MAX_HTTP_CACHE_ENTRIES {
                conn.execute(
                    "DELETE FROM http_cache \
                     WHERE url = (SELECT url FROM http_cache ORDER BY last_accessed ASC LIMIT 1)",
                    [])?;
            }
        }

        let now = now_secs();
        // `last_fetched` is preserved across replacements via subquery so we
        // don't lose the original fetch time on revalidation updates. (TS
        // server preserves it explicitly; subquery does the same in one stmt.)
        conn.execute(
            "INSERT INTO http_cache \
                (url, policy, status_code, content_type, location, response_headers, body, \
                 last_accessed, last_fetched) \
             VALUES \
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, \
                 COALESCE((SELECT last_fetched FROM http_cache WHERE url = ?1), ?8)) \
             ON CONFLICT(url) DO UPDATE SET \
                policy = excluded.policy, \
                status_code = excluded.status_code, \
                content_type = excluded.content_type, \
                location = excluded.location, \
                response_headers = excluded.response_headers, \
                body = excluded.body, \
                last_accessed = excluded.last_accessed",
            rusqlite::params![
                &url,
                &policy_json,
                status_code as i64,
                &content_type,
                &location,
                &response_headers_json,
                &body,
                now])?;
        Ok(())
    }).await?;
    Ok(())
}

/// Serialize repeated response fields without comma-joining values whose
/// grammar may not permit joining.
fn serialize_response_headers(headers: &HeaderMap) -> anyhow::Result<String> {
    let fields =
        headers
            .iter()
            .map(|(name, value)| {
                Ok((
                    name.as_str().to_owned(),
                    value.to_str()?.to_owned()))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(serde_json::to_string(&fields)?)
}

/// Validate every persisted name and value before recreating a `HeaderMap`.
/// A caller can fall back to the legacy columns without losing the body when
/// this metadata is malformed.
fn deserialize_response_headers(json: &str) -> anyhow::Result<HeaderMap> {
    let fields = serde_json::from_str::<Vec<(String, String)>>(json)?;
    let mut headers = HeaderMap::new();
    for (name, value) in fields {
        let name = HeaderName::from_bytes(name.as_bytes())?;
        let value = HeaderValue::from_str(&value)?;
        headers.append(name, value);
    }
    Ok(headers)
}

/// Existing cache rows predate `response_headers`; preserve their two
/// browser-visible representation fields until revalidation repairs the row.
fn legacy_response_headers(content_type: &str, location: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(content_type)
        && !value.is_empty()
    {
        headers.insert(http::header::CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(location)
        && !value.is_empty()
    {
        headers.insert(http::header::LOCATION, value);
    }
    headers
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_headers_round_trip_repeated_values() {
        let mut original = HeaderMap::new();
        original.append(http::header::VARY, HeaderValue::from_static("accept"));
        original.append(http::header::VARY, HeaderValue::from_static("accept-language"));
        original.insert(
            http::header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=3600"));

        let encoded = serialize_response_headers(&original).expect("serialize test headers");
        let decoded = deserialize_response_headers(&encoded).expect("deserialize test headers");

        assert_eq!(decoded["cache-control"], "public, max-age=3600");
        assert_eq!(
            decoded
                .get_all("vary")
                .iter()
                .map(|value| value.to_str().expect("text test value"))
                .collect::<Vec<_>>(),
            ["accept", "accept-language"]);
    }

    #[test]
    fn malformed_response_headers_do_not_validate() {
        let result = deserialize_response_headers(
            r#"[["valid","value"],["not a header name","value"]]"#);
        assert!(result.is_err());
    }

    #[test]
    fn legacy_headers_skip_empty_fields() {
        assert!(legacy_response_headers("", "").is_empty());

        let headers = legacy_response_headers("text/html", "/redirect");
        assert_eq!(headers["content-type"], "text/html");
        assert_eq!(headers["location"], "/redirect");
    }
}
