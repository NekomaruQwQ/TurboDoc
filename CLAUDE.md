# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```sh
just install   # Install bun dependencies for server/ and frontend/
just build     # Build both .NET host (dotnet build) and Rust launcher (cargo build)
just run       # Launch via Rust launcher (spawns server + WinUI host)
just check     # cargo clippy + tsc --noEmit for server/ and frontend/
just unlock    # Delete orphaned lock.toml if a previous run crashed
```

## Tooling Conventions

- **VCS**: jj (Jujutsu) — not git
- **JS runtime / package manager**: bun / bunx --bun — not node / npm / npx
- **Task runner**: just (`.justfile` at repo root, Nushell shell)
- **Linter**: Biome (formatter disabled; linter only)
- **Rust edition**: 2024

## Architecture

TurboDoc is a local-first Rust documentation viewer. See [docs/README.md](docs/README.md) for the full architecture document, component hierarchy, and implementation rules.

Three-layer design:

| Layer | Tech | Role |
|-------|------|------|
| **Host** | C# WinUI 3 (.NET 10) + WebView2 | Window shell — intercepts iframe doc requests, forwards to server `/proxy` endpoint |
| **Server** | TypeScript (Bun + Hono + SQLite) | REST API, HTTP proxy with RFC 7234 cache, dark mode injection, Vite dev middleware |
| **Frontend** | React 19 + Vite 7 + Tailwind v4 + HeroUI v3 | Explorer sidebar, iframe doc viewer, multi-provider plugin architecture |

The **Rust launcher** (`src/main.rs`) orchestrates the full lifecycle: conditional `dotnet build`, spawning the Bun server, polling `lock.toml` for readiness, then spawning the WinUI host. A Windows Job Object guarantees child cleanup.

## Key Entry Points

- `src/main.rs` — Launcher (Rust)
- `app/MainWindow.xaml.cs` — Host (C# WinUI 3)
- `server/index.ts` — Server entry
- `frontend/index.tsx` — Frontend entry
- `frontend/core/data.ts` — Zod schemas, `Provider` interface

## Data Persistence

| Store | Location | Contents |
|-------|----------|----------|
| SQLite | `target/data/cache.sqlite` | HTTP proxy cache + crates.io metadata cache |
| JSON | `target/data/preset.json` | Global app state (presets) |
| JSON | `target/data/{providerId}.json` | Per-provider data (crates, groups) |
| localStorage | Browser | Transient UI state (expanded items, current URL) |

## Environment Variables

- `TURBODOC_PORT` — Server listen port (required)
- `TURBODOC_DATA` — Data directory (set by launcher to `target/data`)
