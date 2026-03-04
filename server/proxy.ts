// HTTP proxy route for documentation pages.
//
// Fetches upstream documentation on behalf of the Rust WebView2 host,
// with http-cache-semantics for RFC 7234 caching and dark mode injection
// at serve time.
//
// Uses stale-while-revalidate: stale cache entries are served immediately
// while a background fetch updates the cache for the next request.
// Cache misses and `?cache=none` bypass still block on upstream.
//
// The Rust host calls `GET /proxy?url={encoded_url}` for every intercepted
// documentation request. This handler returns the response (possibly cached)
// with dark mode script injected for rustdoc HTML pages.

import { Hono } from "hono";
import CachePolicy from "http-cache-semantics";

import * as httpCache from "@/http-cache";
import type { CacheEntry as HttpCacheEntry } from "@/http-cache";

// == Known rustdoc domains ==
//
// All three use the same rustdoc theme system (`rustdoc-theme` localStorage key).
// Since WebView2 preserves the original URL origin, the injection must happen
// per-domain (localStorage is origin-scoped).
const RUSTDOC_PREFIXES = [
    "https://docs.rs",
    "https://doc.rust-lang.org",
    "https://microsoft.github.io/windows-docs-rs/doc/",
];

const DARK_MODE_SCRIPT =
    `<script>window.localStorage.setItem('rustdoc-theme','dark');</script>`;

// == Dark mode injection ==

/**
 * Inject the dark theme script into rustdoc HTML responses.
 * Inserts immediately after `<meta charset="UTF-8">`, matching the previous
 * Rust implementation.
 *
 * Returns the body unchanged if the response is not rustdoc HTML.
 */
function injectDarkMode(url: string, contentType: string, body: Buffer): Buffer {
    if (!contentType.startsWith("text/html")) return body;
    if (!RUSTDOC_PREFIXES.some(prefix => url.startsWith(prefix))) return body;

    const html = body.toString("utf-8");
    const injected = html.replace(
        `<meta charset="UTF-8">`,
        `<meta charset="UTF-8">${DARK_MODE_SCRIPT}`);
    return Buffer.from(injected, "utf-8");
}

// == Helpers ==

/** Convert a Headers object to a plain record for http-cache-semantics. */
function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => { record[key] = value; });
    return record;
}

/**
 * Build the request object that http-cache-semantics expects.
 * We use a minimal GET request — the Rust host only forwards GETs.
 */
function policyRequest(url: string): CachePolicy.Request {
    return { url, method: "GET", headers: {} };
}

/** Default User-Agent for upstream requests. Required by crates.io crawler
 *  policy and good practice for any upstream server. */
const USER_AGENT = "TurboDoc/0.3 (documentation viewer)";

/** Fetch the upstream URL and return the raw Response. */
async function fetchUpstream(
    url: string,
    extraHeaders?: Record<string, string>,
): Promise<Response> {
    return fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, ...extraHeaders },
        redirect: "manual",
    });
}

// == Route definition ==
export default new Hono().get("/", async c => {
    const url = c.req.query("url");
    if (!url) {
        return c.text("Missing 'url' query parameter", 400);
    }

    // `?cache=none` bypasses the cache and fetches fresh from upstream.
    // The fresh response is still stored in cache for future requests.
    const noCache = c.req.query("cache") === "none";

    try {
        const result = await handleProxy(url, noCache);
        return new Response(result.body as any, {
            status: result.status,
            headers: result.headers,
        });
    } catch (err) {
        console.error(`[proxy] Error fetching ${url}:`, err);
        return c.text("Bad Gateway", 502);
    }
});

// == Core proxy logic ==

interface ProxyResult {
    status: number;
    headers: Record<string, string>;
    body: Buffer | null;
}

/** In-flight background refetches, keyed by URL. Prevents duplicate upstream
 *  requests when multiple callers hit the same stale entry concurrently. */
const pendingRefetches = new Map<string, Promise<void>>();

async function handleProxy(url: string, noCache = false): Promise<ProxyResult> {
    const req = policyRequest(url);

    // 1. Check cache (skip when caller requests a fresh fetch)
    const cached = noCache ? null : httpCache.get(url);
    if (cached) {
        if (cached.policy.satisfiesWithoutRevalidation(req)) {
            console.log(`[proxy] HIT (fresh) ${url}`);
            return serveCacheEntry(url, cached);
        }

        // Stale — serve immediately, revalidate in background.
        console.log(`[proxy] HIT (stale, revalidating in background) ${url}`);
        enqueueRevalidation(url, cached);
        return serveCacheEntry(url, cached);
    }

    // 2. Cache miss (or bypassed) — fetch upstream.
    console.log(`[proxy] ${noCache ? "BYPASS" : "MISS"} ${url}`);
    const response = await fetchUpstream(url);
    return await cacheAndServe(url, req, response);
}

// == Stale-while-revalidate ==

/** Enqueue a background revalidation for a stale cache entry.
 *  No-op if a refetch for the same URL is already in flight. */
function enqueueRevalidation(url: string, cached: HttpCacheEntry): void {
    if (pendingRefetches.has(url)) return;

    const task = revalidateInBackground(url, cached)
        .catch(err => console.error(`[proxy] Background revalidation failed for ${url}:`, err))
        .finally(() => pendingRefetches.delete(url));

    pendingRefetches.set(url, task);
}

/** Perform conditional revalidation against upstream without blocking the
 *  caller. Updates the cache entry on success (304 or new response). */
async function revalidateInBackground(url: string, cached: HttpCacheEntry): Promise<void> {
    const req = policyRequest(url);
    const revalHeaders = cached.policy.revalidationHeaders(req);
    const response = await fetchUpstream(url, revalHeaders as Record<string, string>);

    if (response.status === 304) {
        // Not modified — update the policy to extend freshness.
        const policyResponse: CachePolicy.Response = {
            status: response.status,
            headers: headersToRecord(response.headers),
        };
        const { policy: updatedPolicy } = cached.policy.revalidatedPolicy(
            { url, method: "GET", headers: revalHeaders },
            policyResponse);

        httpCache.set(url, { ...cached, policy: updatedPolicy });
        console.log(`[proxy] REVALIDATED (304, background) ${url}`);
    } else {
        // Upstream returned new content — cache it.
        await cacheAndServe(url, req, response);
        console.log(`[proxy] REVALIDATED (new response, background) ${url}`);
    }
}

/**
 * Cache an upstream response if storable, then serve it.
 * Handles both 2xx (content) and 3xx (redirect) responses.
 */
async function cacheAndServe(
    url: string,
    req: CachePolicy.Request,
    response: Response,
): Promise<ProxyResult> {
    const status = response.status;
    const responseHeaders = headersToRecord(response.headers);
    const contentType = response.headers.get("content-type") ?? "";
    const location = response.headers.get("location") ?? "";

    // Read body for 2xx responses. Redirects have no meaningful body.
    const isRedirect = status >= 300 && status < 400;
    const body = isRedirect ? null : Buffer.from(await response.arrayBuffer());

    // Crates.io API responses lack cache directives (no Cache-Control,
    // Last-Modified, or ETag), making them immediately stale under RFC 7234.
    // Inject a 24-hour TTL since crate metadata changes infrequently.
    if (!responseHeaders["cache-control"] && url.startsWith("https://crates.io/api/")) {
        responseHeaders["cache-control"] = "max-age=86400";
    }

    // Build cache policy.
    const policyResponse: CachePolicy.Response = { status, headers: responseHeaders };
    const policy = new CachePolicy(req, policyResponse);

    // Only cache storable and successful/redirect responses.
    if (policy.storable() && (status === 200 || isRedirect)) {
        const entry: HttpCacheEntry = { policy, statusCode: status, contentType, location, body };
        httpCache.set(url, entry);
    }

    return serveResponse(url, status, contentType, location, body);
}

/** Build a ProxyResult from a cache entry, applying dark mode injection. */
function serveCacheEntry(url: string, entry: HttpCacheEntry): ProxyResult {
    return serveResponse(url, entry.statusCode, entry.contentType, entry.location, entry.body);
}

/** Build a ProxyResult, applying dark mode injection for rustdoc HTML. */
function serveResponse(
    url: string,
    status: number,
    contentType: string,
    location: string,
    body: Buffer | null,
): ProxyResult {
    const headers: Record<string, string> = {};

    if (status >= 300 && status < 400) {
        // Redirect — forward the Location header, no body.
        headers.location = location;
        return { status, headers, body: null };
    }

    // Apply dark mode injection at serve time.
    const finalBody = body ? injectDarkMode(url, contentType, body) : null;

    if (contentType) headers["content-type"] = contentType;
    if (finalBody) headers["content-length"] = String(finalBody.length);

    return { status, headers, body: finalBody };
}
