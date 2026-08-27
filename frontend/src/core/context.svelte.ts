import { createContext } from "svelte";

import { DeferredNavigation } from "@/core/documentLifecycle";
import type { ExplorerWorkspaceStore } from "@/core/explorerWorkspaceStore.svelte";
import type { Topic } from "@/core/topic";

export const viewerRef =
    new class { value = $state<HTMLIFrameElement>() };

const viewerNavigation = new DeferredNavigation();

/** Request documentation navigation, deferring it until the native host has
 * made the workbench visible. Pre-release requests are coalesced by
 * `DeferredNavigation`. */
export function navigateTo(url: string) {
    const releasedUrl = viewerNavigation.request(url);
    if (releasedUrl && viewerRef.value) viewerRef.value.src = releasedUrl;
}

/** Release initial documentation loading after the host reports that the
 * top-level frontend is visible. Duplicate reports are idempotent. */
export function releaseViewerNavigation(initialUrl: string) {
    const releasedUrl = viewerNavigation.release(initialUrl);
    if (releasedUrl && viewerRef.value) viewerRef.value.src = releasedUrl;
}

/** Topic-scoped context consumed by generic Explorer descendants. */
export interface ExplorerContext {
    /** Active UI-only topic. */
    topic: () => Topic;
    /** Application-owned Explorer grouping workspace. */
    workspace: () => ExplorerWorkspaceStore;
}

const [getExplorer, setExplorer] = createContext<ExplorerContext>();

export { setExplorer };

/** Return the active Explorer topic. */
export function getTopic(): Topic {
    return getExplorer().topic();
}

/** Return the shared UI-only Explorer workspace store. */
export function getExplorerWorkspace(): ExplorerWorkspaceStore {
    return getExplorer().workspace();
}
