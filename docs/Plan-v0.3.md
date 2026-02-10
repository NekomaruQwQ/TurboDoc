# Project TurboDoc: Architecture v3 (The "Bun Sidecar" Shift)

**Status:** Partially Implemented

**Context:** Moving from a monolithic Rust-heavy MVP to a Hybrid Host + Local Server architecture to improve maintainability, type safety, and UI polish capabilities.

## 1. Executive Summary

TurboDoc is a customized documentation viewer for `docs.rs` designed to reduce friction (loading times, cache invalidation). We are refactoring the application to decouple the **Host** (Windowing/WebView) from the **Logic** (Caching/Parsing).

The target is a **"Bun Sidecar"** architecture:

1.  **Rust Host:** A lightweight "dumb pipe" that handles the window and forwards requests.
2.  **Bun Server:** A local Hono server that handles all business logic, caching, and HTML parsing.
3.  **Frontend:** A standard React+Vite SPA that consumes data via REST APIs from the Bun server.

### Current Implementation Status

The architecture has been **partially migrated**. The Bun+Hono server is running and handles frontend data persistence (workspace/cache CRUD), but the Rust host still owns the HTTP proxy and caching layer.

| Planned Component | Status | Notes |
|-------------------|--------|-------|
| Hono API server | ✅ Implemented | Workspace/cache CRUD via `/api/v1/*` |
| Vite integration | ✅ Implemented | Hono + Vite share a single `node:http` server on port 9680 |
| Frontend data fetching | ✅ Implemented | Uses `hono/client` for type-safe API calls |
| SQLite caching | ❌ Not implemented | Rust still uses file-based memory+disk cache (24h expiry) |
| HTTP proxy in Bun | ❌ Not implemented | Rust still intercepts and proxies docs.rs requests |
| HTML parsing/polish | ❌ Not implemented | Rust injects dark theme script; no cheerio/HTML cleanup |
| Bun as child process | ❌ Not implemented | Dev server started manually via `bun --hot src/server/` |

## 2. High-Level Architecture

### The "Dumb Pipe" Delegate Pattern

Instead of intercepting and handling HTTP requests inside the Rust WebView2 event loop, we **rewrite** the request flow to delegate responsibility to the local Bun server.

+   **Port:** `9680` (single server, Hono API + Vite dev server combined)

### Component Responsibilities

| **Component** | **Tech Stack**          | **Role**              | **Key Responsibilities** |
| ------------- | ----------------------- | --------------------- | ------------------------ |
| **Host**      | Rust (Winit + WebView2) | **The Shell**         | Window management. Intercepts `https://docs.rs/*`, `https://doc.rust-lang.org/*`, `https://microsoft.github.io/windows-docs-rs/*` and proxies them with memory+disk caching. Sends `navigated` events to frontend via WebView2 messages. Opens external URLs in system browser. |
| **Server**    | TypeScript (Bun + Hono) | **The Brain** (partial) | Provides REST endpoints for workspace/cache persistence (`/api/v1/*`). Serves frontend assets via Vite middleware. |
| **Frontend**  | React + Vite            | **The Face**          | UI rendering (Explorer, Navigation). Fetches data from `/api/v1/*` via `hono/client`. Provider-based architecture for multi-source docs. |

**What changed from the original plan:**
- The Rust host still owns HTTP proxying and caching (not yet migrated to Bun)
- Hono and Vite share a single port (9680) instead of separate ports
- No SQLite or `http-cache-semantics` — Rust uses custom file-based caching with 24h expiry
- Frontend IPC is hybrid: Hono HTTP for CRUD, WebView2 messages for navigation events

------

## 3. Implementation Specifications

### A. The Bun Server (`src/server/index.ts`)

+   **Framework:** `hono` (Lightweight, standard Request/Response).
+   **Validation:** `zod` + `@hono/zod-validator`.
+   **Frontend:** Vite dev server in middleware mode.

#### Implemented: API Endpoints (`/api/v1/*`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/workspace` | Load workspace JSON from `target/data/workspace.json` |
| `PUT` | `/api/v1/workspace` | Save workspace JSON |
| `GET` | `/api/v1/cache` | Load cache JSON from `target/data/cache.json` |
| `PUT` | `/api/v1/cache` | Save cache JSON |

The exported `HonoApp` type enables type-safe client usage via `hono/client` in the frontend.

#### Not Yet Implemented: SQLite Caching

The original plan called for SQLite-backed HTTP caching with `http-cache-semantics`. This has not been implemented — the Rust host still handles HTTP proxying with its own memory+disk cache.

```sql
-- Planned but not implemented
CREATE TABLE IF NOT EXISTS cache (
  url TEXT PRIMARY KEY,
  policy TEXT,
  body BLOB,
  created_at INTEGER DEFAULT (unixepoch())
);
```

#### Not Yet Implemented: Proxy Endpoint (`GET /view/*`)

The original plan had the Bun server proxy docs.rs requests. Currently the Rust host intercepts `WebResourceRequested` events and proxies them directly using `reqwest`.

### B. The Rust Host (`src/main.rs`, `src/app.rs`, `src/server.rs`)

**Current state** (differs from original "dumb pipe" plan):

+   **WebView2 Configuration:**
    +   Registers wildcard resource filter for all iframe requests.
    +   Intercepts GET requests matching `KNOWN_URL` prefixes (docs.rs, doc.rust-lang.org, windows-docs-rs).
+   **HTTP Proxy** (still in Rust):
    +   Fetches upstream content via `reqwest`.
    +   Two-tier caching: in-memory `FxHashMap` + disk (TOML metadata + binary content).
    +   24-hour cache expiry.
    +   Injects dark theme script into docs.rs HTML responses.
+   **IPC:**
    +   Sends `navigated` events to frontend via `postMessageAsJson`.
    +   Shows native dialog for external (non-docs) URLs.
+   **Frontend URL:** Navigates to `http://localhost:9680/` on startup.

**Original plan** (not yet achieved):
+   Strip out cache logic from Rust.
+   Forward all intercepted requests to `http://localhost:9680/view/{original_url}`.
+   Spawn Bun server as child process on launch.

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
│   │   └── index.ts         # Hono API + Vite dev server (port 9680)
│   │
│   │ # Rust backend
│   ├── main.rs              # Entry point, constants
│   ├── app.rs               # Window + WebView2 + IPC handlers
│   ├── server.rs            # HTTP proxy with caching
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
2.  [ ] **Implement Cache Logic:** Create SQLite-backed caching with `http-cache-semantics`.
3.  [ ] **Create Proxy Route:** Implement the `/view/*` handler in Hono.
4.  [ ] **Update Rust Host:** Strip out file-system cache logic. Replace with stream forwarding to Bun server.
5.  [x] **Refactor Frontend:** Fetches API data from `/api/v1/*` via `hono/client`.

------

**Constraint Checklist:**

+   [x] **No URL Rewriting:** The WebView still believes it is browsing `docs.rs`.
+   [x] **No SSL Proxy:** Proxying after WebView2 handles the intent.
+   [x] **Fixed Port:** Combined server @ 9680.
+   [x] **OS:** Windows x64 target (WebView2).
