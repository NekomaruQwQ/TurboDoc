# TurboDoc v0.2 Migration Bug Report

This document tracks remaining bugs identified during the v0.2 migration review.

---

## Critical Bugs

### #1: `removeGroup()` leaves orphaned state

**File:** [ExplorerGroupHeader.tsx:109-112](../src/app/ui/explorer/ExplorerGroupHeader.tsx#L109-L112)

**Problem:** Deleting a group only removes it from `groups`, leaving stale entries elsewhere.

```typescript
function removeGroup() {
    updateProviderData(draft => {
        delete draft.groups[groupName];
        // Missing: delete from groupOrder
        // Missing: delete from expandedGroups
        // Missing: handle items in the deleted group
    });
}
```

**Impact:**
- `groupOrder` contains stale group name (causes filter to work, but wastes memory)
- `expandedGroups` contains stale group name
- Items in the deleted group become orphaned (appear in "Ungrouped")

**Fix:** Clean up related state arrays.

**Status (2026-04-01): Fixed.** `deleteGroup()` in `ExplorerGroupHeader.tsx:71-77` now filters `groupOrder` and calls `removeGroup()` to clean up `expandedGroups`.

---

### #2: State updates during render

**File:** [rust/index.tsx:116-117](../src/app/providers/rust/index.tsx#L116-L117)

**Problem:** `handleCurrentUrl()` is called during `render()` and may trigger state updates.

```typescript
function render(ctx: RustProviderContext): ProviderOutput {
    handleCurrentUrl(ctx);  // calls ctx.updateData() and ctx.setCurrentUrl()
    // ...
}
```

**Impact:**
- React warning: "Cannot update a component while rendering a different component"
- Potential infinite render loops in some scenarios
- Violates React's rules of hooks/rendering

**Fix:** Move side effects out of render into `useEffect` hooks.

**Status (2026-04-01): Fixed.** All three side effects in `render()` (starter crate seeding, `handleCurrentUrl`, batch fetch) are now wrapped in `useEffect` with appropriate dependency arrays. `providerContext.updateData` stabilized via `useCallback` in `ExplorerProvider` to prevent unnecessary effect re-runs.

---

### #3: Provider not initialized → crash

**Files:**
- [explorer/index.tsx:37](../src/app/ui/explorer/index.tsx#L37)
- [context.ts:84-88](../src/app/core/context.ts#L84-L88)

**Problem:** If a preset references a provider ID that hasn't been initialized in `workspace.providers`, the app crashes.

```typescript
// In useProviderData():
if (providerData) {
    return [providerData, updateProviderData];
} else {
    throw new Error(`Unexpected provider id: ${provider.id}`);
}
```

**Impact:** App crashes when:
- User adds a provider to a preset that doesn't exist in workspace
- Workspace is corrupted or partially migrated

**Fix:** Guard against missing providers.

**Status (2026-04-01): Fixed.** `useProviderData()` in `context.ts:29-33` is now a plain context consumer. `Explorer` in `explorer/index.tsx` filters undefined providers with `provider && (...)`, preventing the crash path.

---

### #4: "Delete Crate" action leaves orphaned group references

**File:** [rust/index.tsx:264-269](../src/app/providers/rust/index.tsx#L264-L269)

**Problem:** When a crate is deleted via the "Delete Crate" action, it only removes from `draft.crates`. If that crate was assigned to a group, the group will still contain a stale reference to the deleted crate ID.

```typescript
invoke: () => ctx.updateData(draft => {
    delete draft.crates[crateName];
    // Missing: remove from groups
}),
```

**Impact:**
- Groups contain stale item IDs that no longer exist
- While the UI filters these out (items not in `providerOutput.items` won't render), the stale data remains in storage

**Fix:** Also remove the crate from all groups at the deletion site.

**Status (2026-04-01): Mitigated.** The deletion site (`rust/index.tsx:319-326`) still only removes from `draft.crates`. However, `ExplorerProvider` in `explorer/index.tsx:66-79` now has an eager cleanup `useEffect` that removes orphaned item IDs from all groups. The stale data is cleaned up reactively rather than proactively.

---

### #5: Redundant API fetches due to missing in-flight tracking

**File:** [rust/index.tsx:476-484](../src/app/providers/rust/index.tsx#L476-L484)

**Problem:** `getCrateCache` starts an async `refetch()` without tracking in-flight requests. If `render()` is called multiple times before the first fetch completes, multiple redundant API calls are made for the same crate.

```typescript
if (!existing || Date.now() - existing.lastFetched > CACHE_EXPIRY_MS) {
    refetch(crateName, crateCache => { ... });  // No tracking!
}
return existing;
```

**Impact:**
- Redundant network requests to crates.io API
- Potential rate limiting issues
- Wasted bandwidth and processing

**Fix:** Track in-flight requests to prevent duplicates.

**Status (2026-04-01): Fixed.** A module-level `inFlight` Set at `rust/index.tsx:543` prevents duplicate fetches. Checked at render time (line 131), cleaned up in `finally` block of `batchFetchCrateCache`.

---

### #7: `getPageNameFromPath` doesn't handle trailing slashes

**File:** [rust/index.tsx:319-329](../src/app/providers/rust/index.tsx#L319-L329)

**Problem:** When a path ends with `/` (e.g., `"std/vec/"`), `split("/")` produces `["std", "vec", ""]`. The empty string becomes the final segment in the symbol path.

```typescript
const segments = path.split("/");
const fileName = segments.at(-1);  // fileName = ""

if (!fileName || !fileName.endsWith(".html")) {
    return createSymbol(segments, "namespace");  // segments includes ""!
}
```

`createSymbol` then produces a path with an empty-name final segment, rendering as `std::vec::` (dangling `::` from the empty name).

**Impact:**
- User sees malformed symbol names like `tokio::runtime::` instead of `tokio::runtime`
- Affects all module paths that end with `/`

**Fix:** Filter empty segments or strip trailing slash before processing.

**Status (2026-04-01): Fixed.** `rust/index.tsx:376` now uses `.filter(s => s !== "")`.

---

## Moderate Bugs

### #6: IPC handler registered on every render

**File:** [index.tsx:101-105](../src/index.tsx#L101-L105)

**Problem:** The `app` object is recreated on every render, causing the effect to run continuously.

```typescript
useEffect(() => {
    return app
        ? IPC.on("navigated", event => app && app.onNavigated(event.url))
        : undefined;
}, [app]);  // app changes on every render!
```

**Impact:**
- Effect cleanup/setup runs on every render (inefficient)
- Potential timing issues with rapid re-registrations

**Fix:** Use a stable dependency array or ref pattern.

**Status (2026-04-01): Fixed.** `useEffect` in `index.tsx:77-84` now uses an empty `[]` dependency array, registering the IPC handler only once.

---

### #8: No `index.html` normalization in URL handling

**File:** [rust/url.ts:83-87](../src/app/providers/rust/url.ts#L83-L87)

**Problem:** `buildUrl` doesn't normalize `index.html` paths. URLs like `tokio/runtime/index.html` and `tokio/runtime/` point to the same content but are treated as different paths.

```typescript
let path = crate.pathSegments.join("/");
if (!path.endsWith(".html") &&
    !path.endsWith("/")) {
    path = `${path}/`;
}
// No handling for index.html → directory equivalence
```

**Impact:**
- Preview page detection may fail (path comparison mismatch)
- Pinned page matching may fail (same page appears unpinned)
- Duplicate entries possible in `pinnedPages`

**Fix:** Normalize `index.html` to directory form.

**Status (2026-04-01): Open.** Previous fix (normalizing directory-form to `index.html` in `parseUrl`) was reverted — it broke root module detection in `index.tsx` and `import.tsx` (both compare against `"crate/"` form, not `"crate/index.html"`) and caused an undefined-name bug for bare version-root URLs.

---

## Minor Bugs

### #9: Importing root module URLs adds dead entries to `pinnedPages`

**File:** [rust/import.tsx:54-58](../src/app/providers/rust/import.tsx#L54-L58)

**Problem:** When importing a root module URL (e.g., `https://docs.rs/tokio/latest/tokio/`), the path `"tokio/"` is added to `pinnedPages`. However, in `getCratePages`, the root module page always has `pinned: null` and is rendered separately—so the entry is never displayed.

**Impact:**
- Wasted storage in `pinnedPages`
- No user-visible effect (the root page still appears, just not as "pinned")

**Fix:** Skip root module paths during import.

**Status (2026-04-01): Fixed.** `rust/import.tsx:38-42` now explicitly skips root module paths.

---

### #10: Misleading comment about path structure

**File:** [rust/index.tsx:369-371](../src/app/providers/rust/index.tsx#L369-L371)

**Problem:** Comment says doc.rust-lang.org paths exclude the crate name, but they actually include it.

```typescript
// Root module path differs between docs.rs and doc.rust-lang.org:
// - docs.rs: path includes module name (e.g., "tokio/runtime/...")
// - doc.rust-lang.org: path excludes crate name (e.g., "vec/..." not "std/vec/...")
```

The code is correct (`pathSegments` includes the crate name for both); only the comment is wrong.

**Fix:** Update comment to reflect actual behavior.

**Status (2026-04-01): Fixed.** Comment at `rust/index.tsx:425-428` now correctly states both sites include the crate/module name.

---

## Summary

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| #1 | Critical | Fixed | `removeGroup()` leaves orphaned state |
| #2 | Critical | Fixed | State updates during render |
| #3 | Critical | Fixed | Provider not initialized → crash |
| #4 | Critical | Mitigated | "Delete Crate" leaves orphaned group references |
| #5 | Critical | Fixed | Redundant API fetches due to missing in-flight tracking |
| #6 | Moderate | Fixed | IPC handler registered on every render |
| #7 | Critical | Fixed | `getPageNameFromPath` doesn't handle trailing slashes |
| #8 | Moderate | Fixed | No `index.html` normalization in URL handling |
| #9 | Minor    | Fixed | Importing root module URLs adds dead entries |
| #10 | Minor   | Fixed | Misleading comment about path structure |
