# Project TurboDoc: Architecture v3 (The "Bun Sidecar" Shift)

**Status:** Draft / Ready for Implementation

**Context:** Moving from a monolithic Rust-heavy MVP to a Hybrid Host + Local Server architecture to improve maintainability, type safety, and UI polish capabilities.

## 1. Executive Summary

TurboDoc is a customized documentation viewer for `docs.rs` designed to reduce friction (loading times, cache invalidation). We are refactoring the application to decouple the **Host** (Windowing/WebView) from the **Logic** (Caching/Parsing).

We are moving to a **"Bun Sidecar"** architecture:

1.  **Rust Host:** A lightweight "dumb pipe" that handles the window and forwards requests.
2.  **Bun Server:** A local Hono server that handles all business logic, caching, and HTML parsing.
3.  **Frontend:** A standard React+Vite SPA that consumes data via REST APIs from the Bun server.

## 2. High-Level Architecture

### The "Dumb Pipe" Delegate Pattern

Instead of intercepting and handling HTTP requests inside the Rust WebView2 event loop, we **rewrite** the request flow to delegate responsibility to the local Bun server.

+   **Ports:**
    +   **Bun Server:** `9688` (Fixed)
    +   **Vite Dev Server:** `9689` (Fixed)

### Component Responsibilities

| **Component** | **Tech Stack**          | **Role**      | **Key Responsibilities**                                     |
| ------------- | ----------------------- | ------------- | ------------------------------------------------------------ |
| **Host**      | Rust (Winit + WebView2) | **The Shell** | • Window management & System Tray. • Spawns the Bun child process. • Intercepts `https://docs.rs/*` and blindly streams them to `localhost:9688`. • Handles native file dialogs. |
| **Server**    | TypeScript (Bun + Hono) | **The Brain** | • **HTTP Proxy:** Fetches `docs.rs` content. • **Caching:** Implements RFC 7234 via `http-cache-semantics` backed by SQLite. • **HTML Polish:** Parses/cleans HTML (removes ads, injects scripts) before serving. • **API:** Provides REST endpoints for the frontend. |
| **Frontend**  | React + Vite            | **The Face**  | • UI rendering (Navigation, Search, Settings). • Fetches data from `localhost:9688/api`. • Uses Shared Types with the Backend. |

------

## 3. Implementation Specifications

### A. The Bun Server (`server.ts`)

+   **Framework:** `hono` (Lightweight, standard Request/Response).
+   **Database:** `bun:sqlite`.
+   **Caching Logic:** `http-cache-semantics`.

#### 1. Database Schema (`turbodoc_cache.db`)

We use SQLite to store both the raw content and the cache policy metadata.

SQL

```
CREATE TABLE IF NOT EXISTS cache (
  url TEXT PRIMARY KEY,
  policy TEXT,   -- JSON serialized CachePolicy object
  body BLOB,     -- Raw response body (gzip/brotli preserved if possible, or decoded)
  created_at INTEGER DEFAULT (unixepoch())
);

-- Future-proofing for Search
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(url, content);
```

#### 2. The Proxy Endpoint (`GET /view/*`)

+   **Route:** `/view/*` (Wildcard).
+   **Logic:**
    1.  Extract target URL (e.g., `https://docs.rs/tokio`).
    2.  Check SQLite for valid `CachePolicy`.
    3.  **HIT:** Serve from BLOB with correct headers.
    4.  **MISS:** Fetch from upstream `docs.rs`.
        +   Generate new `CachePolicy`.
        +   **Parser Step:** (Future) Parse HTML with `cheerio` to clean/inject scripts.
        +   Store in SQLite.
        +   Stream response to client.

#### 3. The API Endpoints (`GET /api/*`)

+   Provide REST endpoints for frontend needs.
+   Example: `/api/status`, `/api/history`, `/api/search`.

### B. The Rust Host (`main.rs`)

+   **WebView2 Configuration:**
    +   Register `WebResourceRequested` filter for `https://docs.rs/*`.
+   **Interception Handler:**
    +   DO NOT implement cache logic here.
    +   Construct a new HTTP request to `http://localhost:9688/view/{original_url}`.
    +   **Stream** the response body from the local server back to the WebView `IStream`.
+   **Lifecycle:**
    +   On launch: `Command::new("bun").arg("run").arg("server.ts").spawn()`.
    +   On exit: Ensure the child process is killed.

### C. The Frontend (`src/`)

+   **Dev Mode:** Connects to `localhost:9689` (Vite).
+   **Prod Mode:** Served statically by Bun at `localhost:9688/`.
+   **Data Fetching:**
    +   Uses `fetch('/api/...')` which resolves to the Bun server origin.
    +   Types are imported from a shared `types.ts` file (No Zod required, purely TS interfaces).

------

## 4. Directory Structure (Monorepo-lite)

Plaintext

```
/turbodoc
  /src-tauri (or /src-host)  -- Rust code
  /server                    -- Bun Server
    package.json
    src/
      index.ts               -- Hono entry point
      db.ts                  -- SQLite wrapper
      cache.ts               -- http-cache-semantics logic
  /shared                    -- Shared TypeScript definitions
    types.ts
  /ui                        -- React + Vite
    package.json
    src/
```

## 5. Migration Checklist for "Mr. Claude"

1.  **Scaffold Bun Server:** Initialize `Hono` + `bun:sqlite` + `http-cache-semantics`.
2.  **Implement Cache Logic:** Create the `get(url)` and `set(url, res)` wrapper around `http-cache-semantics`.
3.  **Create Proxy Route:** Implement the `/view/*` handler in Hono that fetches, caches, and returns data.
4.  **Update Rust Host:** Strip out old file-system cache logic. Replace with the "Stream Forwarding" logic pointing to port 9688.
5.  **Refactor Frontend:** Ensure it fetches API data from relative paths (`/api/...`).

------

**Constraint Checklist:**

+   [x] **No URL Rewriting:** The WebView must still believe it is browsing `docs.rs`.
+   [x] **No SSL Proxy:** We are proxying *after* WebView2 handles the intent, or via direct HTTP requests for the API.
+   [x] **Fixed Ports:** Bun @ 9688, Vite @ 9689.
+   [x] **OS:** Windows x64 target (WebView2).
