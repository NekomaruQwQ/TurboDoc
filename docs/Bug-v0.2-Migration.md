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

**File:** [rust.crate/index.tsx:121-122](../src/providers/rust.crate/index.tsx#L121-L122)

**Problem:** `handleCurrentUrl()` is called during `render()` and may trigger state updates.

```typescript
function render(ctx: RustCrateProviderContext): ProviderOutput {
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

## Moderate Bugs

### #4: IPC handler registered on every render

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

## Summary

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| #1 | Critical | Open | `removeGroup()` leaves orphaned state |
| #2 | Critical | Open | State updates during render |
| #3 | Critical | Open | Provider not initialized → crash |
| #4 | Moderate | Open | IPC handler registered on every render |