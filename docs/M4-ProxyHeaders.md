# M4: Proxy Response Header Policy

## Status

Approved and implemented. This document defines the response headers that
TurboDoc exposes to WebView2 and the invariants the implementation must
preserve.

## Motivation

TurboDoc currently stores upstream cache policy but exposes only
`Content-Type`, a recomputed `Content-Length`, `Location` for redirects, and a
synthesized `Access-Control-Allow-Origin: *` header to WebView2.

That keeps the response surface small, but it also hides long-lived
`Cache-Control`, `Expires`, and validator headers from Chromium. Shared
rustdoc CSS, JavaScript, and fonts therefore return through
`WebResourceRequested`, SQLite, body copying, and COM response construction
more often than necessary.

The intended result is a two-level cache:

1. WebView2's HTTP cache is the fast, process-local L1 for reusable static
   resources.
2. TurboDoc's SQLite cache remains the persistent, offline-capable L2 and the
   authority for upstream revalidation.

This change should improve warm page navigation without weakening TurboDoc's
offline behavior or allowing arbitrary upstream headers to mutate WebView2
state.

## Decision

Use an explicit allowlist plus a small set of TurboDoc-synthesized headers.
Drop every unlisted header by default.

A blacklist is attractive for protocol fidelity, but TurboDoc is not a
byte-transparent relay:

- `reqwest` may decode the upstream representation before TurboDoc buffers it.
- Rustdoc HTML is modified by dark-mode injection.
- TurboDoc serves stale bodies while revalidating in the background.
- WebView2 receives the response through an embedding and interception
  boundary rather than directly from the origin.
- TurboDoc intentionally grants selected frontend cross-origin reads.

Those transformations can make otherwise valid upstream fields incorrect.
Unknown response fields can also set browser state, initiate reporting, alter
process isolation, or enable authentication behavior. An allowlist makes that
boundary auditable.

The compatibility cost is that a newly introduced harmless or useful upstream
header is ignored until reviewed. Development logging should make such headers
visible without forwarding them.

## Alternatives

### Alternative A: forward everything except a blacklist

Advantages:

- Closest behavior to loading the origin directly.
- New standardized end-to-end headers work automatically.
- Less policy maintenance.

Disadvantages:

- A missed stateful header such as `Set-Cookie`, `Clear-Site-Data`, or
  `Accept-CH` changes persistent WebView2 behavior.
- Body metadata such as `Content-Encoding`, `Content-Length`, validators, and
  digests can become false after decoding or injection.
- Security headers such as CSP and frame restrictions conflict with the
  current inline dark-mode script and iframe architecture.
- Connection-specific and origin-network fields are meaningless on the
  synthetic WebView2 response.

Rejected for the first implementation. It can be reconsidered after the proxy
becomes representation-transparent and has automated compatibility coverage.

### Alternative B: cache headers only

Forward only the current fields plus cache freshness metadata.

Advantages:

- Smallest change and smallest regression surface.
- Captures most of the expected warm-navigation benefit.

Disadvantages:

- Continues to discard useful representation and privacy semantics.
- Leaves the eventual response boundary undocumented.
- Makes later additions ad hoc.

Rejected as the final policy, although the implementation may be staged so the
cache group lands first.

### Alternative C: explicit allowlist

Advantages:

- Every browser-visible capability is intentional and testable.
- Transformed-body exceptions are straightforward.
- Unknown future headers fail closed.

Disadvantages:

- Requires maintenance.
- Can omit a performance or compatibility header until it is observed and
  reviewed.

Selected.

## Policy Inputs

Header selection cannot depend on the upstream headers alone. The builder
needs:

- Response status.
- Original upstream or cache-policy response headers.
- Final body length.
- Whether TurboDoc modified the representation.
- Whether the response is being served stale.
- Whether the URL is explicitly readable by the TurboDoc frontend.

The implementation should keep this logic in one pure function, tentatively:

```rust
fn build_webview_headers(
    upstream: &HeaderMap,
    status: StatusCode,
    body_len: Option<usize>,
    body_modified: bool,
    served_stale: bool,
    cors: CorsPolicy,
) -> HeaderMap
```

`build_webview_headers` names the destination and purpose more clearly than
`filter_headers`; the function also synthesizes and overrides fields, so it is
not merely a filter.

`CorsPolicy` should be an enum rather than a boolean so future policies remain
named and call sites cannot invert the meaning accidentally:

```rust
enum CorsPolicy {
    PreserveUpstream,
    PublicFrontendRead,
}
```

No new dependency is needed.

## Allowed Headers

### Representation metadata

| Header | Policy | Justification |
|---|---|---|
| `Content-Type` | Forward; omit if absent | WebView2 needs the media type for rendering, script, style, font, and MIME-sniffing decisions. |
| `Content-Length` | Never forward; always recompute from the final body | Decoding and dark-mode injection can change byte length. A generated value is correct for both cached and upstream responses. Omit when the response has no body. |
| `Content-Language` | Forward | Describes the selected representation and can affect accessibility and language-sensitive behavior without setting persistent browser state. |
| `Content-Disposition` | Forward | Preserves inline versus attachment behavior and filenames for documentation downloads. |
| `Location` | Forward only on 3xx responses | Required for redirects. Relative locations remain relative to the original intercepted URL. Omit on other statuses to avoid accidental navigation semantics. |
| `Retry-After` | Forward only on 429 and 503 responses | Preserves meaningful retry information for failed metadata and documentation requests. |

### Cache freshness and validation

| Header | Policy | Justification |
|---|---|---|
| `Cache-Control` | Forward for fresh representations, including stably injected HTML; apply the stale override below | This is the primary mechanism that lets WebView2 retain reusable responses and obey `no-store`, `private`, and revalidation requirements. |
| `Date` | Forward the cache-policy-adjusted value | Required for correct age calculation. `http-cache-semantics` already updates it on a fresh hit. |
| `Age` | Forward the cache-policy-adjusted value | Prevents WebView2 from treating an already-aged L2 response as newly fetched. |
| `Expires` | Forward | Supports upstreams that express freshness without `Cache-Control: max-age`. |
| `ETag` | Forward only when the body is unmodified | A strong upstream validator is false after dark-mode injection. Static CSS, JavaScript, fonts, and untouched HTML can retain it. |
| `Last-Modified` | Forward | The dark-mode transform is stable and deterministic, so output changes whenever its upstream input changes. The upstream modification time remains a useful validator and heuristic-freshness input. |
| `Vary` | Forward | WebView2 must distinguish variants using the same request fields as the L2 policy. `Vary: *` must remain effective. |
| `Warning` | Forward when produced by `http-cache-semantics` | Preserves cache warnings, including heuristic-staleness information, without granting additional browser capabilities. |

TurboDoc should not parse and reconstruct cache directives. Values should come
from `http-cache-semantics` response parts on cache hits and from the validated
`HeaderMap` on misses. This avoids subtle RFC errors and preserves extension
directives such as `immutable` and `stale-while-revalidate`.

### CORS

| Header | Policy | Justification |
|---|---|---|
| `Access-Control-Allow-Origin` | Preserve upstream, or synthesize `*` only for `PublicFrontendRead` URLs when absent | Crate metadata is intentionally readable by the localhost frontend. Documentation resources should retain origin behavior rather than becoming universally readable. |
| `Access-Control-Allow-Credentials` | Forward only from upstream; never synthesize | `*` cannot be combined with credentialed CORS, and TurboDoc does not need credentialed metadata access. |
| `Access-Control-Expose-Headers` | Forward | Preserves the set of response fields visible to upstream scripts. |
| `Access-Control-Allow-Methods` | Forward | Relevant if a future intercepted preflight is supported; harmless on ordinary responses. |
| `Access-Control-Allow-Headers` | Forward | Same rationale as `Access-Control-Allow-Methods`. |
| `Access-Control-Max-Age` | Forward | Preserves upstream preflight caching semantics. |

The first implementation can keep the existing broad synthesized CORS behavior
if changing it would expand the patch too far, but the target state is scoped
synthesis for crate-index and crates.io metadata URLs only.

When `PublicFrontendRead` synthesizes
`Access-Control-Allow-Origin: *`, it must not also emit an upstream
`Access-Control-Allow-Credentials: true` field.

### Privacy, security, and diagnostics that remain compatible

| Header | Policy | Justification |
|---|---|---|
| `Referrer-Policy` | Forward | Reduces or controls referrer disclosure and does not conflict with response transformation. |
| `X-Content-Type-Options` | Forward | `nosniff` remains valid because TurboDoc preserves `Content-Type`. |
| `Permissions-Policy` | Forward | Preserves upstream feature restrictions without enabling a feature or setting persistent state. |
| `Cross-Origin-Resource-Policy` | Forward | The intercepted response keeps its original URL and origin, so resource-origin restrictions remain meaningful. |
| `Server-Timing` | Forward | Useful for latency diagnosis and does not control cache or browser state. |
| `Timing-Allow-Origin` | Forward | Preserves upstream permission for Resource Timing visibility. |

## Conditional Overrides

### Stably injected representations

Rustdoc HTML may receive an inline dark-mode script. The injection function
should return both the bytes and whether an insertion actually occurred:

```rust
struct InjectedBody {
    bytes: Vec<u8>,
    modified: bool,
}
```

The explicit flag avoids guessing from URL or content type when the expected
HTML anchor was absent.

Dark-mode injection is a stable, deterministic representation transform:

- The same upstream bytes produce the same output bytes.
- Injection behavior does not depend on user state or runtime theme settings.
- A future change to the injected bytes or their semantics must explicitly
  revise browser-cache invalidation before it lands.

Under this invariant, injected HTML remains cacheable according to its
upstream freshness policy. TurboDoc must not make it less cacheable merely
because the deterministic transform ran, and must not make it more cacheable
than the origin intended.

When `modified` is true:

- Recompute `Content-Length`.
- Drop the upstream strong `ETag` and all digest fields because they describe
  different bytes.
- Drop `Content-Encoding`.
- Preserve `Cache-Control`, `Expires`, `Date`, `Age`, `Last-Modified`, and
  `Vary`.

A future optimization may generate a TurboDoc validator derived from the
upstream validator and an explicit transformation version. That is unnecessary
for the first implementation and would add invalidation complexity. Until
then, injected HTML can use freshness and `Last-Modified` without claiming
that the upstream strong entity tag validates TurboDoc's different bytes.

### Stale L2 responses

TurboDoc deliberately serves stale bodies immediately while revalidating in
the background. A stale response must not become fresh in WebView2's L1.

When `served_stale` is true:

- Preserve representation fields.
- Set downstream `Cache-Control: no-cache`, overriding positive freshness.
- Preserve `Age` and `Date` when available.
- Apply the usual validator policy: retain `Last-Modified`, and retain `ETag`
  only when the body was not injected.

The next navigation therefore returns to TurboDoc, where the background
revalidation may already have installed a fresh entry.

### Redirects

For 3xx responses:

- Forward `Location`.
- Forward the allowed cache fields so WebView2 can cache a redirect only when
  the upstream policy permits it.
- Emit an empty body and no `Content-Length`, or an explicit length of zero if
  WebView2 requires it.
- Do not forward representation-only fields that describe a discarded
  upstream redirect body.

### Empty responses

For 204, 205, and 304 responses:

- Do not create a body stream.
- Do not emit a nonzero `Content-Length`.
- Preserve status-appropriate cache and validator fields.

TurboDoc currently tends to resolve upstream 304 responses inside the L2
revalidation path. Tests should still make the response builder correct for
these statuses.

## Blocked Headers

### Connection and transport fields

| Header | Reason for blocking |
|---|---|
| `Connection` | Applies to one network hop and may nominate additional hop-by-hop fields. |
| `Keep-Alive` | Describes an upstream connection that WebView2 is not using. |
| `Proxy-Connection` | Non-standard hop-by-hop proxy field. |
| `TE` | Describes transfer-coding support for a network hop. |
| `Trailer` | TurboDoc buffers the body and does not deliver HTTP trailers. |
| `Transfer-Encoding` | TurboDoc provides a complete body stream and generated length, not the upstream wire encoding. |
| `Upgrade` | TurboDoc does not expose protocol upgrades through a synthetic response. |
| `Alt-Svc` | Must not redirect future WebView2 networking around TurboDoc's interception and cache. |

`http-cache-semantics` already removes standard hop-by-hop fields from fresh
response parts. The explicit block remains necessary for misses and documents
the boundary.

### Fields invalidated by body handling

| Header | Reason for blocking |
|---|---|
| `Content-Encoding` | `reqwest` may already have decoded the body. Forwarding the original encoding could make WebView2 decode it twice. |
| `Accept-Ranges` | TurboDoc does not currently implement byte-range serving. Advertising support would be false. |
| `Content-Range` | A partial response is not supported by the current full-body cache representation. |
| `Content-MD5` | Deprecated and invalid after transformation. |
| `Digest` | Can describe bytes that TurboDoc decoded or changed. |
| `Content-Digest` | Same issue as `Digest`; do not forward without recomputing it. |
| `Repr-Digest` | Same issue as `Digest`; do not forward without a precise representation model. |
| `Content-Location` | Can introduce alternate representation/cache-key semantics that the URL-only L2 storage does not model explicitly. |

Range support should be designed separately. WebView2's response API requires
the host to honor incoming `Range` and produce the corresponding status,
`Content-Range`, and body slice.

### Browser state, credentials, and origin policy

| Header | Reason for blocking |
|---|---|
| `Set-Cookie` | Public documentation does not require authentication; accepting it adds tracking and persistent state. |
| `Set-Cookie2` | Obsolete cookie field with the same state concerns. |
| `Clear-Site-Data` | Can destructively clear cookies, storage, or cache owned by the embedded origin. |
| `Strict-Transport-Security` | WebView2 never needs to upgrade these intercepted HTTPS origins through this synthetic response. |
| `Accept-CH` | Persists client-hint preferences and expands browser fingerprinting/state. |
| `Critical-CH` | Can force retries based on client hints that the proxy does not model. |
| `WWW-Authenticate` | TurboDoc does not support an origin authentication exchange. |
| `Authentication-Info` | Meaningless without the corresponding authentication flow. |
| `Proxy-Authenticate` | Refers to a network proxy, not TurboDoc's in-process response path. |
| `Proxy-Authentication-Info` | Same rationale as `Proxy-Authenticate`. |

If authenticated providers are added later, cookie and authentication support
needs a provider-level threat model rather than removal from this list.

### Embedding and execution policies that conflict with current architecture

| Header | Reason for blocking |
|---|---|
| `Content-Security-Policy` | The current inline dark-mode injection has no nonce or hash and may be rejected. `frame-ancestors` can also reject TurboDoc's iframe. |
| `Content-Security-Policy-Report-Only` | Adds external reporting side effects and can report TurboDoc's injected script. |
| `X-Frame-Options` | TurboDoc's primary viewer is an iframe; forwarding `DENY` or incompatible `SAMEORIGIN` would prevent the product from functioning. |
| `Cross-Origin-Opener-Policy` | Alters browsing-context relationships and is not needed for embedded documentation. |
| `Cross-Origin-Embedder-Policy` | Can reject dependent resources that TurboDoc currently serves successfully. |
| `Origin-Agent-Cluster` | Alters process/origin isolation and should not be enabled implicitly through an unreviewed upstream field. |
| `Refresh` | Can cause timed navigation as a header side effect. Normal 3xx `Location` redirects remain supported. |
| `Link` | Can initiate preload or preconnect work, including direct traffic to origins outside TurboDoc's proxy. Revisit with explicit same-origin parsing if profiling shows a benefit. |

This is a deliberate compatibility/security trade-off. TurboDoc only proxies
configured public documentation origins, but stripping CSP and frame
restrictions is less faithful than a normal browser. A future dark-mode
implementation that avoids inline injection should revisit CSP forwarding,
including controlled removal or rewriting of only `frame-ancestors`.

### Reporting, obsolete, and infrastructure fields

| Header | Reason for blocking |
|---|---|
| `Report-To` | Creates external reporting behavior unrelated to documentation viewing. |
| `Reporting-Endpoints` | Same rationale as `Report-To`. |
| `NEL` | Enables network-error reporting and persistent reporting state. |
| `Expect-CT` | Obsolete certificate-transparency reporting policy. |
| `Public-Key-Pins` | Obsolete and unsafe browser security state. |
| `Public-Key-Pins-Report-Only` | Obsolete reporting behavior. |
| `P3P` | Obsolete privacy-policy field. |
| `Server` | Exposes origin infrastructure without changing representation behavior. |
| `Via` | Describes upstream intermediaries that are not part of the WebView2 response hop. |
| `X-Powered-By` | Infrastructure disclosure with no viewer benefit. |
| `X-Cache` | Upstream cache diagnostic; TurboDoc should log its own cache result instead. |
| `X-Cache-Hits` | Same rationale as `X-Cache`. |
| `X-Served-By` | Upstream topology disclosure with no viewer behavior. |

Other vendor-specific infrastructure fields, including CDN request IDs and
trace identifiers, remain blocked unless a concrete diagnostic need is
documented.

### Unknown headers

Every header not listed in the allowed section is blocked.

In debug builds, log each distinct dropped header name once per process. Do
not log values because they may contain identifiers or sensitive data. This
provides compatibility discovery without increasing normal navigation log
volume or leaking data.

## Cache Storage Design

`CachePolicy` internally retains upstream response headers, but its fields are
private. A fresh `BeforeRequest::Fresh(parts)` result exposes correctly aged
response parts; `BeforeRequest::Stale` does not expose the cached response
headers.

Do not depend on the serialized JSON layout of `CachePolicy`. It is an
implementation detail of `http-cache-semantics` and has already changed across
the former TypeScript and current Rust implementations.

Add an explicit `response_headers` field to `CacheEntry`, containing only the
allowed upstream-derived fields. Store it as a JSON array of name/value pairs
so repeated fields are preserved:

```text
[
  ["cache-control", "public, max-age=31536000, immutable"],
  ["vary", "accept-encoding"]
]
```

The final synthesized fields (`Content-Length`, scoped CORS, and stale or
modified overrides) should not be stored. They are rebuilt for each response.

### SQLite migration

Add a nullable or defaulted `response_headers` text column:

```sql
ALTER TABLE http_cache
ADD COLUMN response_headers TEXT NOT NULL DEFAULT '[]';
```

Startup migration must be idempotent by checking `PRAGMA table_info` before
the `ALTER TABLE`; `CREATE TABLE IF NOT EXISTS` does not add columns to an
existing table.

Legacy rows should remain usable:

- Fresh legacy hits can use the headers returned by
  `BeforeRequest::Fresh(parts)`.
- Stale legacy hits fall back to the existing `content_type` and `location`
  columns plus downstream `Cache-Control: no-cache`.
- A later successful revalidation or replacement populates
  `response_headers`.

Keep the existing `content_type` and `location` columns during this milestone.
Removing them provides little performance benefit and makes rollback and
migration riskier.

### Revalidation

The revalidation path must update stored response headers:

- For `AfterResponse::NotModified`, use the merged response parts returned by
  `http-cache-semantics` to refresh cache metadata while keeping the body.
- For `AfterResponse::Modified`, sanitize and store headers from the new
  response alongside the new body.

Ignoring these parts would retain outdated freshness or validator fields even
after a successful 304.

## Implementation Sequence

1. Add a pure response-header policy module under `src/server/proxy/`.
2. Change dark-mode injection to report whether it modified the body.
3. Extend `CacheEntry` and the SQLite schema with `response_headers`, including
   legacy fallback behavior.
4. Feed the correct header source into each path:
   - Fresh hit: `BeforeRequest::Fresh(parts)`.
   - Stale hit: stored allowed headers with stale overrides.
   - Miss: upstream response headers.
   - Revalidated entry: merged or replacement response headers.
5. Build one final `HeaderMap` immediately before creating the
   `http::Response<Vec<u8>>`.
6. Scope synthesized permissive CORS to frontend-readable metadata URLs, or
   explicitly defer that behavior change to a follow-up.
7. Add cache-path and WebView2 validation tests.

The header work should land before asynchronous WebView2 deferrals. Keeping
the changes separate makes it possible to measure how much latency is removed
by Chromium caching alone.

## Testing

### Unit tests

Use table-driven tests for the pure header builder:

- Every allowed header survives with its value intact.
- Every explicitly blocked header is absent.
- An unknown extension header is absent.
- Repeated allowed fields remain repeated.
- `Content-Length` matches the final body after dark-mode injection.
- `Content-Encoding` is absent after a decoded body is served.
- `Set-Cookie`, CSP, frame restrictions, and reporting fields are absent.
- `Location` is present for 3xx and absent for 2xx.
- Validators survive untouched static assets but are removed from modified
  HTML.
- Injected fresh HTML retains upstream cache directives while dropping its
  upstream strong `ETag`.
- Stale bodies receive downstream `Cache-Control: no-cache`.
- Fresh immutable assets retain `max-age` and `immutable`.
- Synthesized wildcard CORS cannot be combined with credentialed CORS.
- Empty statuses do not receive a nonzero length or body.

### Cache tests

- Existing databases migrate without deleting body data.
- Legacy rows without `response_headers` remain readable.
- Header arrays round-trip repeated fields through SQLite.
- A 304 revalidation updates stored freshness fields while retaining the body.
- A modified revalidation replaces both headers and body.

### Manual WebView2 validation

Test docs.rs, the standard library, and windows-docs-rs:

1. Cold load a root page.
2. Navigate between two pages from the same origin.
3. Confirm shared immutable CSS, JavaScript, and fonts are served from
   WebView2's cache or no longer reach TurboDoc's handler.
4. Restart TurboDoc without network access and confirm the L2 cache still
   loads the page.
5. Confirm the dark theme remains active.
6. Confirm crates-index metadata remains readable from the frontend.
7. Confirm redirects and external-link cancellation still behave correctly.
8. Inspect WebView2's cookie store and verify upstream `Set-Cookie` fields
   were not accepted.

Record:

- Number of `WebResourceRequested` callbacks per navigation.
- Click-to-frame-navigation-completed duration.
- Fresh, stale, and miss counts in the TurboDoc cache.
- Bytes copied from SQLite into WebView2.

Compare cold, warm, and offline cases before and after the change.

## Safety and Error Handling

- Header names and values remain represented by `http::HeaderName` and
  `http::HeaderValue`; do not concatenate unvalidated upstream strings.
- WebView2's response conversion requires text header values. If a value
  cannot be represented, drop it and log only the header name.
- Preserve multiple allowed values rather than comma-joining fields whose
  grammar may not permit joining.
- A malformed stored header array should not invalidate the cached body.
  Log the cache metadata error, use the legacy fallback, and allow
  revalidation to repair the row.
- Never panic because an optional upstream field is absent.
- No cache schema migration should delete the existing cache.

## Performance Considerations

The allowlist walk is linear in the small number of upstream response fields
and is negligible compared with SQLite access, body cloning, COM stream
creation, and network latency.

The expected gain comes from avoiding the entire interception path for warm,
long-lived static assets. Hashed rustdoc assets commonly carry long positive
freshness and `immutable`; these should remain in WebView2's L1 across iframe
navigations.

HTML remains conservative because TurboDoc modifies it. This keeps the unique
document request on the L2 path while removing repeated static dependencies,
which is the desired trade-off.

Do not add a new header-parsing or cache dependency. `http`,
`http-cache-semantics`, `serde_json`, and the existing WebView2 conversion are
sufficient.

## Acceptance Criteria

- The policy is an explicit allowlist with fail-closed unknown headers.
- Cache freshness reaches WebView2 for unmodified responses and stably
  injected HTML.
- Stale bodies cannot become independently fresh in WebView2.
- Injected HTML remains deterministic and cache-stable; a future
  state-dependent transform must revise invalidation first.
- No cookie, authentication, reporting, connection, unsupported range, or
  invalid body-integrity field reaches WebView2.
- Dark-mode injection and iframe embedding continue to work.
- Existing cache databases migrate without data loss.
- Warm same-origin navigation produces materially fewer proxy callbacks.
- Unit tests, cache tests, `cargo test`, and `cargo clippy` pass with no new
  warnings.

## References

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111)
- [WebView2: custom management of network requests](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested)
- [WebView2: working with local content](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)
- [WebView2 WebResourceResponse](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2webresourceresponse)
