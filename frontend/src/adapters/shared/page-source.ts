import type { Page, PageLayout, SourceItem, SourceView } from "@/core/explorer";
import type { SourceModelContext } from "@/core/source";
import {
    normalizePinnedPages,
    type ResolvedSourcePage,
    type ResolveSourcePage,
} from "@/adapters/shared/page-order";

/** URL and naming rules shared by page-oriented source adapters. */
export interface PageSourceRules {
    /** Fixed page displayed first and opened from search/topic selection. */
    readonly homeUrl: string;
    /** Structurally accept an already parsed URL. */
    readonly ownsUrl: (url: URL) => boolean;
    /** Canonicalize accepted aliases on a private URL copy. */
    readonly normalizeUrl?: (url: URL) => void;
    /** Derive a non-home page label from a canonical URL copy. */
    readonly resolvePageName: (url: URL) => string;
    /** Optionally override canonical URL-without-fragment identity. */
    readonly resolvePageIdentity?: (url: URL) => string;
}

/** Validated routing state compiled for one source definition. */
export interface PageSourceRuntime {
    /** Canonical fixed home page. */
    readonly home: ResolvedSourcePage;
    /** Resolve navigation only when this source safely owns it. */
    readonly resolvePage: ResolveSourcePage;
    /** Source rules copied during adapter resolution. */
    readonly rules: PageSourceRules;
}

/** Minimum flat persistence shape needed by page-source rendering. */
export interface PageSourceData {
    /** Schema version owned by the concrete adapter. */
    schemaVersion: 1;
    /** Ordered canonical pin targets. */
    pinnedPages: string[];
}

/** Adapter-specific page organization hooks around common page rendering. */
export interface PageSourceRendering<D extends PageSourceData> {
    /** Read a sanitized current pin list without mutating during render. */
    readPinnedPages(context: SourceModelContext<D>): string[];
    /** Persist a sanitized pin list and reconcile adapter-specific metadata. */
    writePinnedPages(context: SourceModelContext<D>, pages: readonly string[]): void;
    /** Build book sections or user collections from the common pages. */
    createLayout(context: SourceModelContext<D>, pages: readonly Page[]): PageLayout;
}

/** Validate URL rules and compile the routing pipeline for one source. */
export function createPageSourceRuntime(
    sourceId: string,
    rules: PageSourceRules,
): PageSourceRuntime {
    const stableRules: PageSourceRules = { ...rules };
    const resolvePage: ResolveSourcePage = input => {
        let url: URL;
        try {
            url = new URL(input);
        } catch {
            return null;
        }
        if (!isSafePageUrl(url)) return null;

        try {
            if (!stableRules.ownsUrl(url)) return null;
            stableRules.normalizeUrl?.(url);
            url.searchParams.sort();
            if (!isSafePageUrl(url) || !stableRules.ownsUrl(url)) return null;
            const identity = stableRules.resolvePageIdentity
                ? stableRules.resolvePageIdentity(new URL(url.href))
                : defaultPageIdentity(url);
            return identity ? { sourceId, url: url.href, identity } : null;
        } catch {
            return null;
        }
    };

    const home = resolvePage(stableRules.homeUrl);
    if (!home) {
        throw new Error(
            `Source "${sourceId}" does not own its home URL "${stableRules.homeUrl}".`);
    }
    return { home, resolvePage, rules: stableRules };
}

/** Normalize one source's pins while excluding its fixed home page. */
export function readNormalizedPinnedPages(
    runtime: PageSourceRuntime,
    pages: unknown,
): string[] {
    return normalizePinnedPages(
        runtime.home.sourceId,
        runtime.home.identity,
        pages,
        runtime.resolvePage);
}

/** Render one page-oriented source as one source-local Explorer item. */
export function renderPageSource<D extends PageSourceData>(
    context: SourceModelContext<D>,
    sourceId: string,
    sourceName: string,
    runtime: PageSourceRuntime,
    rendering: PageSourceRendering<D>,
): SourceView {
    const currentTarget = runtime.resolvePage(context.currentUrl);
    const currentIdentity = currentTarget?.sourceId === sourceId
        ? currentTarget.identity
        : null;
    const pinnedPages = rendering.readPinnedPages(context);
    const pinnedIdentities = new Set(pinnedPages.flatMap(page => {
        const target = runtime.resolvePage(page);
        return target ? [target.identity] : [];
    }));

    const pages: Page[] = [{
        name: { type: "text", text: "Home" },
        sortKey: "",
        url: runtime.home.url,
        current: currentIdentity === runtime.home.identity,
        pinned: null,
        setPinned: () => {},
    }];

    for (const [index, url] of pinnedPages.entries()) {
        const target = runtime.resolvePage(url);
        if (!target) continue;
        pages.push({
            name: { type: "text", text: resolvePageName(runtime, target) },
            sortKey: index.toString().padStart(8, "0"),
            url,
            current: target.identity === currentIdentity,
            pinned: true,
            setPinned(pinned) {
                if (pinned) return;
                rendering.writePinnedPages(context,
                    rendering.readPinnedPages(context).filter(page =>
                        runtime.resolvePage(page)?.identity !== target.identity));
            },
        });
    }

    if (currentTarget?.sourceId === sourceId &&
        currentTarget.identity !== runtime.home.identity &&
        !pinnedIdentities.has(currentTarget.identity)) {
        pages.push({
            name: { type: "text", text: resolvePageName(runtime, currentTarget) },
            sortKey: "",
            url: currentTarget.url,
            current: true,
            pinned: false,
            setPinned(pinned) {
                if (!pinned) return;
                rendering.writePinnedPages(context,
                    [...rendering.readPinnedPages(context), currentTarget.url]);
            },
        });
    }

    const item: SourceItem = {
        id: sourceId,
        name: sourceName,
        sortKey: "",
        pages,
        pageLayout: rendering.createLayout(context, pages),
    };
    return {
        items: { [item.id]: item },
        search: {
            activeItemId: currentTarget?.sourceId === sourceId ? item.id : undefined,
            selectItem(itemId) {
                if (itemId === item.id) context.navigateTo(runtime.home.url);
            },
            getAddAction: () => null,
        },
    };
}

/** Require encrypted credential-free page targets. */
function isSafePageUrl(url: URL): boolean {
    return url.protocol === "https:" && !url.username && !url.password;
}

/** Use canonical URL without its section as the default page identity. */
function defaultPageIdentity(url: URL): string {
    const identity = new URL(url.href);
    identity.hash = "";
    return identity.href;
}

/** Resolve a compact page label while insulating navigation from policy errors. */
function resolvePageName(
    runtime: PageSourceRuntime,
    target: ResolvedSourcePage,
): string {
    if (target.identity === runtime.home.identity) return "Home";
    try {
        return runtime.rules.resolvePageName(new URL(target.url)).trim() || "Page";
    } catch {
        return "Unknown page";
    }
}
