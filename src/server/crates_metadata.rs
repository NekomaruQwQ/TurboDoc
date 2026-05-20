//! Parsing for crates.io's `/api/v1/crates/{name}` responses.
//!
//! Caching is delegated to the standard HTTP proxy cache — see
//! [`crate::server::proxy::synth_max_age_for`], which synthesizes a 24h
//! `cache-control` on crates.io URLs so the RFC 7234 path treats them as
//! cacheable.

use serde::Deserialize;
use serde::Serialize;

/// Normalized crate metadata returned by `POST /api/v1/crates`. Flattened
/// from the nested crates.io response shape — the frontend never sees the
/// raw upstream format.
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
