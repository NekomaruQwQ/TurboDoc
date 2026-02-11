# Project TurboDoc: Architecture v3 (The "Bun Sidecar" Shift)

**Status:** In Progress

**Context:** Moving from a monolithic Rust-heavy MVP to a Hybrid Host + Local Server architecture to improve maintainability, type safety, and UI polish capabilities.

## 1. Executive Summary

TurboDoc is a customized documentation viewer for `docs.rs` designed to reduce friction (loading times, cache invalidation). We are refactoring the application to decouple the **Host** (Windowing/WebView) from the **Logic** (Caching/Parsing).

The target is a **"Bun Sidecar"** architecture:

1.  **Rust Host:** A lightweight "dumb pipe" that handles the window and forwards requests.
2.  **Bun Server:** A local Hono server that handles all business logic, caching, and HTML parsing.
3.  **Frontend:** A standard React+Vite SPA that consumes data via REST APIs from the Bun server.

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Hono API server | Done | Workspace/cache CRUD via `/api/v1/*` |
| Vite integration | Done | Hono + Vite share a single `node:http` server on port 9680 |
| Frontend data fetching | Done | Uses `hono/client` for type-safe API calls |
| HTTP proxy in Bun | In Progress | `GET /proxy?url=` route with `http-cache-semantics` |
| SQLite caching | In Progress | `bun:sqlite` with LRU eviction (max entry count) |
| Dark mode injection | In Progress | Moved to Bun serve time; all three rustdoc domains |
| Rust host simplification | In Progress | Stripping cache logic, forwarding to Bun proxy |
| Bun as child process | Not started | Dev server started manually via `bun --hot src/server/` |

## 2. High-Level Architecture

### The "Dumb Pipe" Delegate Pattern

Instead of intercepting and handling HTTP requests inside the Rust WebView2 event loop, we **delegate** all proxy and caching logic to the local Bun server.

+   **Port:** `9680` (single server: Hono API + proxy + Vite dev server)

### Request Flow

```
WebView2 iframe navigates to https://docs.rs/serde/latest/serde/
  │
  ├─ on_frame_navigation_starting: post "navigated" event to frontend
  │
  └─ on_web_resource_requested (GET, KNOWN_URL match):
       │
       │  Rust forwards to Bun:
       │  GET http://localhost:9680/proxy?url=https%3A%2F%2Fdocs.rs%2Fserde%2Flatest%2Fserde%2F
       │
       └─ Bun /proxy handler:
            ├─ Cache HIT + fresh?  → serve cached body + dark mode injection
            ├─ Cache HIT + stale?  → conditional revalidation (If-None-Match / If-Modified-Since)
            │    ├─ 304 Not Modified → update policy, serve cached body
            │    └─ 2xx             → replace cache entry, serve new body
            └─ Cache MISS          → fetch upstream, cache if storable, serve
```

### Component Responsibilities

| **Component** | **Tech Stack** | **Role** | **Key Responsibilities** |
|---|---|---|---|
| **Host** | Rust (Winit + WebView2) | **The Shell** | Window management. Intercepts `KNOWN_URL` requests and forwards them to `http://localhost:9680/proxy?url=`. Sends `navigated` events to frontend via WebView2 messages. Opens external URLs in system browser. |
| **Server** | TypeScript (Bun + Hono) | **The Brain** | REST endpoints for workspace/cache persistence (`/api/v1/*`). HTTP proxy with SQLite caching and LRU eviction (`/proxy?url=`). Dark mode injection at serve time. Serves frontend assets via Vite middleware. |
| **Frontend** | React + Vite | **The Face** | UI rendering (Explorer, Navigation). Fetches data from `/api/v1/*` via `hono/client`. Provider-based architecture for multi-source docs. |

------

## 3. Implementation Specifications

### A. The Bun Server (`src/server/`)

+   **Framework:** `hono` (Lightweight, standard Request/Response).
+   **Validation:** `zod` + `@hono/zod-validator`.
+   **Cache:** `bun:sqlite` (built-in, zero dependency) + `http-cache-semantics` (RFC 7234).
+   **Frontend:** Vite dev server in middleware mode.

#### API Endpoints (`/api/v1/*`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/workspace` | Load workspace JSON from `target/data/workspace.json` |
| `PUT` | `/api/v1/workspace` | Save workspace JSON |
| `GET` | `/api/v1/cache` | Load cache JSON from `target/data/cache.json` |
| `PUT` | `/api/v1/cache` | Save cache JSON |

The exported `HonoApp` type enables type-safe client usage via `hono/client` in the frontend.

#### Proxy Endpoint (`GET /proxy?url=`)

Fetches documentation pages on behalf of the Rust host, with caching and dark mode injection.

1. Decode the `url` query parameter.
2. Look up in SQLite cache via `HttpCache.get(url)`.
3. On hit: reconstruct `CachePolicy`, check freshness, conditionally revalidate.
4. On miss: `fetch(url, { redirect: "manual" })` upstream.
5. If response is storable (`policy.storable()`), cache it. Evict LRU if at capacity.
6. Apply dark mode injection for rustdoc HTML responses.
7. Return response to the Rust host.

Redirect handling: `fetch()` is called with `redirect: "manual"` so 3xx responses are captured and forwarded to WebView2 (which handles redirects within the iframe).

#### SQLite HTTP Cache (`src/server/cache.ts`)

```sql
CREATE TABLE IF NOT EXISTS http_cache (
  url              TEXT PRIMARY KEY,
  policy           TEXT NOT NULL,       -- JSON: CachePolicy.toObject()
  status_code      INTEGER NOT NULL,
  content_type     TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',  -- for 3xx redirects
  body             BLOB,                -- response body (null for redirects)
  last_accessed_at INTEGER NOT NULL,    -- unix seconds, for LRU eviction
  cached_at        INTEGER NOT NULL     -- unix seconds, for diagnostics
);
```

- `policy` stores the full serialized `CachePolicy` from `http-cache-semantics` (includes original request/response headers).
- `body` is `BLOB` — responses may be binary (images, wasm, etc.).
- `last_accessed_at` is updated on every cache hit (the LRU key).
- **LRU eviction**: Before inserting, if `COUNT(*) >= MAX_CACHE_ENTRIES` (default: 2000), delete the entry with the smallest `last_accessed_at`.

#### Dark Mode Injection

Applied at **serve time**, not cache time. The cache stores clean upstream content.

- **Scope:** All three rustdoc domains (docs.rs, doc.rust-lang.org, windows-docs-rs).
- **Condition:** `content_type` starts with `text/html` AND `url` matches a known rustdoc domain.
- **Technique:** Insert `<script>window.localStorage.setItem('rustdoc-theme', 'dark');</script>` after `<meta charset="UTF-8">`.

Benefits:
- Change injection logic without invalidating the cache.
- Cache is a faithful mirror of upstream content.
- Could later make dark mode a user preference toggle without cache involvement.

### B. The Rust Host (`src/main.rs`, `src/app.rs`)

The Rust host becomes a thin forwarding shim:

+   **WebView2 Configuration:**
    +   Registers wildcard resource filter for all iframe requests (unchanged).
    +   Intercepts GET requests matching `KNOWN_URL` prefixes (unchanged).
+   **HTTP Forwarding** (replaces the old proxy+cache):
    +   On intercepted request: `reqwest::blocking::get("http://localhost:9680/proxy?url={encoded}")`.
    +   Reads response status, headers (`Content-Type`, `Location`), and body from Bun.
    +   Constructs `WebResponse` and returns to WebView2.
+   **IPC:**
    +   Sends `navigated` events to frontend via `postMessageAsJson` (unchanged).
    +   Shows native dialog for external (non-docs) URLs (unchanged).
+   **Frontend URL:** Navigates to `http://localhost:9680/` on startup (unchanged).

**Deleted from Rust:**
- `src/server.rs` (entire file + `cache/` submodule)
- `CACHE_DIR`, `CACHE_EXPIRY` constants
- `toml` dependency (was only used for cache metadata serialization)

### C. The Frontend (`src/app/`)

+   **Dev Mode:** Served by Vite middleware at `http://localhost:9680/`.
+   **Data Fetching:**
    +   Uses `hono/client` with the exported `HonoApp` type for type-safe API calls.
    +   Workspace and cache loaded on mount, auto-saved on every change.
    +   Navigation events received via WebView2 `postMessage` (not HTTP).
+   **Provider Architecture:** Multi-provider system (see README.md).

------

## 4. Directory Structure

```
TurboDoc/
├── package.json             # Bun project, script: `bun --hot src/server/`
├── vite.config.ts           # Root: src/, aliases: @/ → src/, @shadcn/ → 3rdparty/shadcn/
├── tsconfig.json            # ESNext, bundler mode, strict
├── Cargo.toml               # Rust workspace
│
├── src/
│   ├── index.html           # Entry HTML
│   ├── index.tsx            # React entry point
│   ├── global.css           # Global styles
│   ├── global.tailwind.css  # Tailwind entry
│   │
│   ├── app/                 # Frontend application code
│   │   ├── core/            # Data model, context, IPC, utilities
│   │   ├── providers/       # Documentation providers (rust/)
│   │   ├── ui/              # React components (App, explorer/)
│   │   └── utils/           # Shared utilities (version-group)
│   │
│   ├── server/
│   │   ├── index.ts         # Hono API + proxy route + Vite dev server (port 9680)
│   │   ├── proxy.ts         # /proxy?url= route handler + dark mode injection
│   │   └── cache.ts         # HttpCache class (bun:sqlite, LRU eviction)
│   │
│   │ # Rust backend
│   ├── main.rs              # Entry point, constants
│   ├── app.rs               # Window + WebView2 + request forwarding
│   └── webview.rs           # WebView2 COM wrapper
│
├── 3rdparty/
│   └── shadcn/              # Vendored shadcn/ui components
│
└── crates/
    ├── nkcore/              # Core utilities
    └── nkcore-macros/       # Procedural macros
```

## 5. Migration Checklist

1.  [x] **Scaffold Bun Server:** Initialize Hono server with Vite integration.
2.  [ ] **Implement HTTP Cache:** Create SQLite-backed `HttpCache` with `bun:sqlite` and LRU eviction.
3.  [ ] **Create Proxy Route:** Implement `GET /proxy?url=` with `http-cache-semantics` and dark mode injection.
4.  [ ] **Update Rust Host:** Strip out `server.rs` and cache logic. Replace with forwarding to Bun proxy.
5.  [x] **Refactor Frontend:** Fetches API data from `/api/v1/*` via `hono/client`.

------

**Constraint Checklist:**

+   [x] **No URL Rewriting:** The WebView still believes it is browsing `docs.rs`.
+   [x] **No SSL Proxy:** Proxying after WebView2 handles the intent.
+   [x] **Fixed Port:** Combined server @ 9680.
+   [x] **OS:** Windows x64 target (WebView2).
