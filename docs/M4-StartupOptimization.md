# M4: Startup Optimization

## Status

Initial investigation complete. The confirmed dependency-optimization
regression is fixed; the follow-up opportunities below have been analyzed but
not experimentally validated.

## Confirmed Findings

TurboDoc now starts Vite concurrently with native window and WebView2
creation, paints the native window with the frontend workbench color, waits up
to five seconds for Vite's empty `GET /ready` response carrying the current
launch token, and then requests the initial navigation. This identity check
prevents a stale Vite process on the configured port from satisfying
readiness. The WebView2 controller remains hidden until navigation succeeds,
with a 30-second deadline. The host continues monitoring Vite afterward and
returns to the native error surface if the child exits.

The dominant observed regression was in the frontend development path.
`@lucide/svelte`, `bits-ui`, and `paneforge` had been placed in both client and
SSR `optimizeDeps.exclude` lists. That moved their large module graphs into
Vite's on-demand transform path. Restoring `vite-plugin-svelte`'s default
prebundling and replacing the remaining Lucide icon-barrel import with
`@lucide/svelte/icons/pin` reduced observed startup from roughly 20–28 seconds
to about 7 seconds.

Temporary top-level `NavigationStarting`, `DOMContentLoaded`, and Vite
first-request probes were useful for isolating that delay, but were removed
afterward. Permanent telemetry is intentionally limited to initialization
milestones and phase durations attached to real startup behavior. See
[README.md](README.md#checking-for-startup-regressions) for the cold/warm
measurement procedure.

## Analyzed but Not Yet Experimented

These are hypotheses, not conclusions. Test one variable at a time and retain
the complete `startup +… ms` sequence with each result.

### Vite cold-cache and invalidation behavior

Changes to Vite configuration, dependencies, or `bun.lock` invalidate
`frontend/node_modules/.vite`. We have not collected repeated cold and warm
samples to establish variance or a baseline distribution.

Experiment:

1. Collect at least five launches after removing only
   `frontend/node_modules/.vite`.
2. Collect at least five launches without changing configuration or
   dependencies.
3. Compare medians and ranges separately; do not compare a cold launch against
   a warm launch.

This is the highest-priority follow-up because it determines whether the
remaining approximately seven seconds are stable or mostly one-time work.

### Vite transform graph and plugin cost

The current telemetry identifies when Vite answers its readiness endpoint, but
it does not attribute subsequent module transforms to Svelte, Tailwind,
dependency optimization, or application module evaluation. Large import
barrels, dynamically discovered dependencies, and plugin transform waterfalls
can all delay the initial page.

Experiment:

- Temporarily launch Vite with plugin-transform debug output and capture which
  files and plugins dominate the first navigation.
- Use a browser performance trace to correlate module requests with the final
  controller-visible milestone.
- Treat any explicit `optimizeDeps.include` entries as benchmarked exceptions,
  not permanent guesses. In particular, never include the Lucide collection
  barrel when individual icon paths are sufficient.

### Prewarming the frontend entry graph

The HTTP readiness endpoint proves that Vite's middleware is listening; it
does not prove that the frontend entry module and its transitive Svelte
components have been transformed. Vite warmup configuration or an explicit
host-side warmup could move work before WebView2 navigation.

Experiment:

- Compare the default behavior against Vite `server.warmup` for the actual
  frontend entry and eagerly rendered component files.
- Count total startup, not merely navigation time. Moving the same work before
  `Navigate` is not an improvement unless it overlaps native initialization or
  reduces the controller-visible timestamp.

### Vite child-process launch path

The host currently invokes `bunx --bun vite dev`. Package resolution and
process startup may add latency before Vite itself initializes. We have not
compared it with a package script or direct local Vite executable.

Experiment:

- Compare `bunx --bun vite dev`, `bun run <vite-script>`, and a direct
  repository-local Vite entry while preserving Bun as the runtime.
- Use the existing `Vite task started`, `Vite child spawned`, and `Vite ready`
  milestones to distinguish command-launch overhead from server startup.

### WebView2 environment and controller creation

WebView2 environment and controller creation remain opaque native operations.
Their cost may vary with the Evergreen runtime version, existing Edge/WebView2
processes, profile state, disk cache, GPU initialization, or security-software
scanning. The phase timers measure the cost, but we have not varied these
inputs.

Experiment:

- Compare launches after reboot, repeated launches in one session, and a
  disposable alternate WebView2 user-data folder.
- Record the installed WebView2 runtime version with results.
- Use Windows performance tooling to inspect disk/process activity before
  considering exclusions; do not disable endpoint protection merely to obtain
  a faster sample.

Do not delete or repurpose TurboDoc's real WebView2 profile for this test,
because it contains persistent browser state.

### Controller reveal criterion

The controller is revealed on successful top-level `NavigationCompleted`.
This is robust and avoids a partially loaded surface, but it may be later than
the first usable frontend frame. We have not compared it with
`DOMContentLoaded` or an explicit frontend “mounted and painted” message.

Experiment:

- Temporarily record navigation start, DOM readiness, frontend mount, first
  animation frame after mount, and navigation completion.
- If a frontend-ready signal is consistently earlier, test revealing on that
  signal while retaining navigation-failure handling and the opaque startup
  background.

This can improve perceived startup even when total background loading is
unchanged.

### Initial documentation iframe workload

The frontend restores a documentation URL into an iframe during startup.
Network access, proxy/cache work, rustdoc parsing, and iframe resources may
compete with shell rendering or influence the top-level completion boundary.
We have not measured startup with the iframe initially blank and restored only
after the shell becomes visible.

Experiment:

- Add a temporary flag that delays iframe restoration until after the
  workbench mounts.
- Compare both time-to-visible-shell and time-to-usable-document.
- Preserve the normal URL and cache state between paired runs.

### Frontend initialization after module delivery

Svelte mount, local-storage restoration, provider rendering, effects, and
initial component layout occur after Vite delivers the graph. No browser-side
performance marks currently divide those phases.

Experiment:

- Add temporary `performance.mark` calls immediately before mount, after the
  root component mounts, and after the first animation frame.
- Use the WebView2 DevTools performance profiler to identify long tasks,
  synchronous storage access, layout, and style recalculation.
- Remove the detailed marks after attributing the cost, keeping only telemetry
  that guards an actual regression boundary.

### Backend and SQLite initialization

The in-process backend opens the SQLite cache before native startup begins.
The existing phase duration will expose a regression, but lazy cache opening,
migration work, and overlap with the frontend have not been benchmarked.

Experiment:

- First establish whether `in-process backend ready` is material relative to
  total startup.
- Only if it is material, compare current eager initialization with a design
  that opens the cache on first intercepted request or initializes it
  concurrently while preserving error reporting and request ordering.

### Vite readiness polling granularity

The `/ready` HTTP check polls every 100 milliseconds, adding between zero and
roughly 100 milliseconds after Vite begins answering requests. This cannot
explain multi-second regressions and has not been optimized.

Experiment only if sub-100-millisecond startup work becomes worthwhile:
compare a shorter polling interval or a child-ready signal while checking CPU
usage and failure behavior.

### Packaged frontend path

TurboDoc currently has only the Vite development path. A packaged build served
through WebView2 virtual-host folder mapping would remove Vite process startup,
dependency optimization, and development transforms entirely. It has not been
implemented or benchmarked and should be treated as a separate production
architecture decision rather than a tuning change to `just run`.

## Experiment Discipline

- Change one factor per comparison.
- Keep data directory, WebView2 profile, dependency versions, and machine
  power state constant unless one of them is the tested factor.
- Report cold and warm results separately.
- Prefer medians and ranges over a single launch.
- Use the final `WebView2 NavigationCompleted …; controller shown` timestamp
  as the current headline metric, while retaining intermediate phase timings
  for attribution.
- Revert temporary high-volume event handlers and browser/Vite tracing after
  each investigation.
