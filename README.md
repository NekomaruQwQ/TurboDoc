# TurboDoc

A fast, local-first Rust documentation workbench for Windows.

![TurboDoc showing Rust documentation in its compact desktop workbench](docs/img/screenshot.png)

TurboDoc keeps the Rust documentation you use every day in one focused workspace. Search for crates, pin important pages, organize references into groups, and follow cross-crate links without growing another forest of browser tabs. Visited documentation is cached locally and revalidated in the background, keeping repeat navigation quick without freezing the ecosystem at an offline snapshot.

> [!NOTE]
> TurboDoc is under active development, currently supports Rust documentation, and is built from source on Windows.

## Why TurboDoc?

Offline documentation browsers work well when a language ships stable, self-contained docsets. Rust's ecosystem is different: crates evolve quickly on [docs.rs](https://docs.rs/), link freely into the standard library and one another, and are often consulted together while working on a project.

TurboDoc treats documentation as a workspace rather than a collection of disconnected tabs. It combines live upstream docs with a persistent explorer and an HTTP-aware local cache, so references stay organized while their content stays current.

## Highlights

- **Focused desktop workbench** — a compact, VS Code-inspired interface with a native Windows title bar, resizable explorer, and dedicated document pane
- **Unified Rust documentation** — browse docs.rs, doc.rust-lang.org, and windows-docs-rs through one provider
- **Fast crate access** — search crates from the pinned explorer combobox or import docs.rs URLs in bulk
- **Persistent organization** — arrange crates into collapsible named groups and keep versions, pinned pages, and expansion state across sessions
- **Preview and pin workflow** — navigate freely through one transient preview page per crate, then pin the references worth keeping
- **Navigation-aware explorer** — cross-crate links are recognized automatically and the matching crate and page are revealed in the sidebar
- **Version selection** — load recommended releases on demand and switch through semver-grouped versions, including `latest`
- **Local HTTP cache** — SQLite-backed caching follows upstream freshness rules, serves stale content immediately while revalidating, and evicts old entries with an LRU policy
- **Consistent dark rendering** — rustdoc dark mode is injected as pages are served, avoiding a bright flash during navigation
- **Extensible provider model** — the frontend renders a common view model, keeping future documentation sources isolated behind provider implementations

## Getting Started

TurboDoc currently targets Windows 10/11 and uses the Microsoft Edge WebView2 Runtime.

### Prerequisites

- A current [Rust toolchain](https://rustup.rs/) using the Windows MSVC target
- [Bun](https://bun.sh/)
- [just](https://github.com/casey/just)
- [Nushell](https://www.nushell.sh/), used by the `just` recipes
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), normally included with current Windows installations

### Build and Run

```sh
# Install the frontend dependencies and vendored shadcn-svelte components.
just install

# Build the optimized host and copy Vite artifacts beside the executable.
just release

# Run the built frontend with repository-local data.
just run --data data

# Or develop the frontend through Vite with HMR.
just dev
```

The directory passed to `--data` stores the workspace files and HTTP cache. Release mode is the default and loads `public/` beside the executable without opening a local port. `--dev` starts Vite; its required `--port` also accepts the `TURBODOC_PORT` environment variable. `--data` accepts `TURBODOC_DATA` in both modes. Runtime mode is independent of Cargo's build profile.

## Architecture

The desktop shell and backend live in one Rust process. By default, WebView2 maps the built frontend from `public/` beside the executable to a private HTTPS origin. Development mode instead owns a Vite child process for hot-module replacement. There is no loopback HTTP server for documentation or application data: WebView2 requests are intercepted and dispatched directly to the in-process backend.

```text
WebView2
├─ docs.rs / Rust standard library / windows-docs-rs
│  └─ WebResourceRequested → Server::fetch
│       └─ SQLite cache ↔ upstream documentation
├─ /api/* (release: https://api.turbodoc.example; dev: Vite origin)
│  └─ WebResourceRequested → Server::dispatch_api
│       └─ TOML workspace data
└─ Frontend assets
   ├─ release → WebView2 virtual host → executable-adjacent public/
   └─ --dev  → Vite child process + HMR
```

The proxy cache applies upstream cache directives, conditional revalidation, stale-while-revalidate, and LRU eviction before returning responses directly to WebView2. The Svelte frontend uses ordinary navigation and `fetch` calls; release API calls use a separate reserved origin because WebView2 does not raise request-interception events for URLs claimed by a virtual-host folder mapping.

| Layer | Technologies |
|---|---|
| **Desktop shell** | Rust · eframe/egui · wgpu/DX12 · winit · WebView2 |
| **In-process backend** | Tokio · reqwest · rusqlite · http-cache-semantics |
| **Frontend** | Svelte 5 · Vite 8 · Tailwind CSS 4 · shadcn-svelte/Bits UI · Paneforge |
| **Tooling** | Bun · just · Nushell · Biome |

See [the architecture and implementation notes](docs/README.md) for the provider model, request flow, persistence, and frontend structure.

## License

[GPL-3.0](LICENSE)
