import BookOpenText from "@lucide/svelte/icons/book-open-text";

import type {
    Item,
    Page,
    Provider,
    ProviderContext,
    ProviderOutput,
} from "@/core/data";

import { normalizePinnedPages, reorderPinnedPages } from "./page-order";
import {
    DOC_SITES,
    type DocPageTarget,
    type DocSite,
    getDocPageIdentity,
    getDocPageName,
    parseDocPageTarget,
} from "./sites";

/** Ordered user-owned state for one immutable catalog site. */
export interface DocSiteData {
    /** Pinned absolute page targets in the user's chosen order. */
    pinnedPages: string[];
}

/** Persisted provider state keyed by stable catalog site ID. */
export interface DocProviderData {
    /** Site state is optional so an empty provider store remains valid. */
    sites?: Record<string, DocSiteData>;
}

/** Reactive context specialized to the Doc provider's persisted data. */
export type DocProviderContext = ProviderContext<DocProviderData>;

const DocProvider: Provider<DocProviderData> = {
    id: "doc",
    name: "Doc",
    icon: { type: "lucide", icon: BookOpenText },
    homeUrl: DOC_SITES[0].homeUrl,
    enableItemGrouping: true,
    renderItemNameAsCode: false,
    renderPageNameAsCode: false,
    ownsUrl: url => parseDocPageTarget(url) !== null,
    render,
};

export default DocProvider;

/** Derive the immutable site catalog and its user-owned page state. */
function render(ctx: DocProviderContext): ProviderOutput {
    const items = Object.fromEntries(
        DOC_SITES.map(site => [site.id, renderSite(ctx, site)]));
    const activeSiteId = parseDocPageTarget(ctx.currentUrl)?.site.id;

    return {
        items,
        search: {
            placeholder: "Search documentation sites",
            activeItemId: activeSiteId,
            selectItem(itemId: string) {
                const site = DOC_SITES.find(candidate => candidate.id === itemId);
                if (site) ctx.navigateTo(site.homeUrl);
            },
            getAddAction: () => null,
            invalidText: "No supported documentation site matches that name.",
        },
    };
}

/** Render one flat site item with fixed home, pinned pages, and preview tail. */
function renderSite(ctx: DocProviderContext, site: DocSite): Item {
    const currentTarget = parseDocPageTarget(ctx.currentUrl);
    const currentIdentity = currentTarget?.site.id === site.id
        ? getDocPageIdentity(currentTarget.url)
        : null;
    const homeIdentity = getDocPageIdentity(site.homeUrl);
    const pinnedPages = readPinnedPages(ctx, site);
    const pinnedIdentities = new Set(
        pinnedPages.map(page => getDocPageIdentity(page)));

    const pages: Page[] = [{
        name: { type: "text", text: "Home" },
        sortKey: "",
        url: site.homeUrl,
        current: currentIdentity === homeIdentity,
        pinned: null,
        setPinned: () => {},
    }];

    for (const [index, url] of pinnedPages.entries()) {
        const identity = getDocPageIdentity(url);
        pages.push({
            name: { type: "text", text: getDocPageName(site, url) },
            sortKey: index.toString().padStart(8, "0"),
            url,
            current: identity === currentIdentity,
            pinned: true,
            setPinned(pinned: boolean) {
                if (pinned || !identity) return;
                writePinnedPages(
                    ctx,
                    site,
                    readPinnedPages(ctx, site).filter(page =>
                        getDocPageIdentity(page) !== identity));
            },
        });
    }

    if (isUnpinnedPreview(currentTarget, site, homeIdentity, pinnedIdentities)) {
        pages.push({
            name: {
                type: "text",
                text: getDocPageName(site, currentTarget.url),
            },
            sortKey: "",
            url: currentTarget.url,
            current: true,
            pinned: false,
            setPinned(pinned: boolean) {
                if (!pinned) return;
                writePinnedPages(
                    ctx,
                    site,
                    [...readPinnedPages(ctx, site), currentTarget.url]);
            },
        });
    }

    return {
        id: site.id,
        name: site.name,
        sortKey: site.name,
        pages,
        reorderPages(orderedUrls: string[]) {
            const current = readPinnedPages(ctx, site);
            const reordered = reorderPinnedPages(current, orderedUrls);
            if (!reordered || reordered.every((page, index) => page === current[index]))
                return;
            writePinnedPages(ctx, site, reordered);
        },
    };
}

/** Check whether the accepted Doc navigation needs a temporary preview row. */
function isUnpinnedPreview(
    currentTarget: DocPageTarget | null,
    site: DocSite,
    homeIdentity: string | null,
    pinnedIdentities: ReadonlySet<string | null>): currentTarget is DocPageTarget {
    if (!currentTarget || currentTarget.site.id !== site.id) return false;
    const identity = getDocPageIdentity(currentTarget.url);
    return identity !== null &&
        identity !== homeIdentity &&
        !pinnedIdentities.has(identity);
}

/** Read a sanitized view without mutating during provider render derivation. */
function readPinnedPages(ctx: DocProviderContext, site: DocSite): string[] {
    return normalizePinnedPages(
        site.id,
        site.homeUrl,
        ctx.data.sites?.[site.id]?.pinnedPages ?? []);
}

/** Persist a sanitized ordered page list, lazily creating site storage. */
function writePinnedPages(
    ctx: DocProviderContext,
    site: DocSite,
    pages: readonly string[]): void {
    ctx.data.sites ??= {};
    ctx.data.sites[site.id] ??= { pinnedPages: [] };
    ctx.data.sites[site.id].pinnedPages = normalizePinnedPages(
        site.id,
        site.homeUrl,
        pages);
}
