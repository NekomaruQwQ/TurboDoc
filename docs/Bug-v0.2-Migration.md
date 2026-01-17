# TurboDoc v0.2 Migration Bug Report

This document tracks remaining bugs identified during the v0.2 migration review.

---

## Critical Bugs

### #1: `removeGroup()` leaves orphaned state

**File:** [ExplorerGroupHeader.tsx:109-112](../src/ui/explorer/ExplorerGroupHeader.tsx#L109-L112)

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

**Fix:** Clean up related state arrays:
```typescript
function removeGroup() {
    updateProviderData(draft => {
        delete draft.groups[groupName];
        draft.groupOrder = draft.groupOrder.filter(name => name !== groupName);
        draft.expandedGroups = draft.expandedGroups.filter(name => name !== groupName);
        // Items automatically appear in "Ungrouped" which may be acceptable
    });
}
```

---

### #2: State updates during render

**File:** [rust/index.tsx:116-117](../src/providers/rust/index.tsx#L116-L117)

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

**Fix:** Move side effects out of render. Options:
1. Use `useEffect` in the component that calls `render()`
2. Make `handleCurrentUrl` return data instead of mutating, let caller handle updates
3. Use a separate synchronization mechanism outside the render path

---

### #3: Provider not initialized → crash

**Files:**
- [explorer/index.tsx:37](../src/ui/explorer/index.tsx#L37)
- [context.ts:84-88](../src/core/context.ts#L84-L88)

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

**Fix:** Initialize provider data lazily when first accessed:
```typescript
export function useProviderData(): State<ProviderData> {
    const ctx = useAppContext();
    const provider = useProvider();
    let providerData = ctx.workspace.providers[provider.id];

    // Initialize if missing
    if (!providerData) {
        ctx.updateWorkspace(draft => {
            draft.providers[provider.id] = {
                data: {},
                groups: {},
                groupOrder: [],
                expandedItems: [],
                expandedGroups: [],
            };
        });
        providerData = ctx.workspace.providers[provider.id];
    }
    // ...
}
```

---

### #4: "Delete Crate" action leaves orphaned group references

**File:** [rust/index.tsx:264-269](../src/providers/rust/index.tsx#L264-L269)

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

**Fix:** Also remove the crate from all groups:
```typescript
invoke: () => {
    ctx.updateData(draft => {
        delete draft.crates[crateName];
    });
    updateProviderData(draft => {
        for (const group of Object.values(draft.groups)) {
            group.items = group.items.filter(id => id !== crateName);
        }
    });
},
```

---

### #5: Redundant API fetches due to missing in-flight tracking

**File:** [rust/index.tsx:476-484](../src/providers/rust/index.tsx#L476-L484)

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

**Fix:** Track in-flight requests to prevent duplicates:
```typescript
const inFlightRequests = new Set<string>();

function getCrateCache(...) {
    if (!existing || Date.now() - existing.lastFetched > CACHE_EXPIRY_MS) {
        if (!inFlightRequests.has(crateName)) {
            inFlightRequests.add(crateName);
            refetch(crateName, crateCache => {
                inFlightRequests.delete(crateName);
                // ... update cache
            });
        }
    }
    return existing;
}
```

---

### #7: `getPageNameFromPath` doesn't handle trailing slashes

**File:** [rust/index.tsx:319-329](../src/providers/rust/index.tsx#L319-L329)

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

**Fix:** Filter empty segments or strip trailing slash before processing:
```typescript
const segments = path.split("/").filter(s => s !== "");
```

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

**Fix:** Use a ref to hold the latest app instance, or memoize the handler:
```typescript
const appRef = useRef(app);
appRef.current = app;

useEffect(() => {
    return IPC.on("navigated", event => {
        appRef.current?.onNavigated(event.url);
    });
}, []);  // Only register once
```

---

### #8: No `index.html` normalization in URL handling

**File:** [rust/url.ts:83-87](../src/providers/rust/url.ts#L83-L87)

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

**Fix:** Normalize `index.html` to directory form:
```typescript
if (path.endsWith("/index.html")) {
    path = path.slice(0, -"index.html".length);
}
```

---

## Minor Bugs

### #9: Importing root module URLs adds dead entries to `pinnedPages`

**File:** [rust/import.tsx:54-58](../src/providers/rust/import.tsx#L54-L58)

**Problem:** When importing a root module URL (e.g., `https://docs.rs/tokio/latest/tokio/`), the path `"tokio/"` is added to `pinnedPages`. However, in `getCratePages`, the root module page always has `pinned: null` and is rendered separately—so the entry is never displayed.

**Impact:**
- Wasted storage in `pinnedPages`
- No user-visible effect (the root page still appears, just not as "pinned")

**Fix:** Skip root module paths during import:
```typescript
const rootPath = `${page.name.replaceAll("-", "_")}/`;
if (path !== rootPath && !(importCrates[page.name]?.includes(path))) {
    // ... add to pinnedPages
}
```

---

### #10: Misleading comment about path structure

**File:** [rust/index.tsx:369-371](../src/providers/rust/index.tsx#L369-L371)

**Problem:** Comment says doc.rust-lang.org paths exclude the crate name, but they actually include it.

```typescript
// Root module path differs between docs.rs and doc.rust-lang.org:
// - docs.rs: path includes module name (e.g., "tokio/runtime/...")
// - doc.rust-lang.org: path excludes crate name (e.g., "vec/..." not "std/vec/...")
```

The code is correct (`pathSegments` includes the crate name for both); only the comment is wrong.

**Fix:** Update comment to reflect actual behavior:
```typescript
// Both docs.rs and doc.rust-lang.org paths include the crate/module name:
// - docs.rs: "tokio/runtime/..."
// - doc.rust-lang.org: "std/vec/..."
```

---

## Summary

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| #1 | Critical | Open | `removeGroup()` leaves orphaned state |
| #2 | Critical | Open | State updates during render |
| #3 | Critical | Open | Provider not initialized → crash |
| #4 | Critical | Open | "Delete Crate" leaves orphaned group references |
| #5 | Critical | Open | Redundant API fetches due to missing in-flight tracking |
| #6 | Moderate | Open | IPC handler registered on every render |
| #7 | Critical | Fixed | `getPageNameFromPath` doesn't handle trailing slashes |
| #8 | Moderate | Open | No `index.html` normalization in URL handling |
| #9 | Minor    | Fixed | Importing root module URLs adds dead entries |
| #10 | Minor   | Fixed | Misleading comment about path structure |
