import type {
    IconProp,
    Item,
    Page,
    Provider,
    ProviderContext,
    ProviderOutput,
} from "@/core/data";

import {
    normalizePinnedPages,
    type ResolvedDocPage,
} from "./page-order";
import { createCollectionLayout, normalizePageCollections, type PageCollections } from "./page-collections";
import { createSectionLayout, type DocPageOrganization } from "./page-sections";

/** A code-owned documentation site exposed as one provider item. */
export interface DocSiteConfig {
    /** Stable identifier used by persistence and group membership. */
    readonly id: string;

    /** User-facing site name. */
    readonly name: string;

    /** Fixed page displayed first and opened when the site is selected. */
    readonly homeUrl: string;

    /** Return whether this site structurally owns an already parsed URL.
     * Implementations must not mutate the supplied URL. */
    readonly ownsUrl: (url: URL) => boolean;

    /** Canonicalize accepted aliases before comparison and persistence.
     * Implementations may mutate only the supplied URL. */
    readonly normalizeUrl?: (url: URL) => void;

    /** Derive the non-home page label from a canonical URL.
     * Implementations must not mutate the supplied URL. */
    readonly resolvePageName: (url: URL) => string;

    /** Exclusive source-owned organization policy; never inferred by the UI. */
    readonly organization: DocPageOrganization;

    /** Optionally override the default canonical URL without its fragment.
     * The returned identity must be non-empty and stable across navigation. */
    readonly resolvePageIdentity?: (url: URL) => string;
}

/** Search wording owned by one configured Doc provider. */
export interface DocProviderSearchConfig {
    /** Placeholder shown by the Explorer search combobox. */
    readonly placeholder: string;

    /** Guidance shown when no configured site matches the input. */
    readonly invalidText: string;
}

/** Compile-time configuration consumed by {@link createDocProvider}. */
export interface DocProviderConfig {
    /** Stable provider ID used by persistence, UI state, and routing. */
    readonly id: string;

    /** User-facing provider name shown by the navigation rail. */
    readonly name: string;

    /** Provider mark shown by the navigation rail. */
    readonly icon: IconProp;

    /** Site whose canonical home becomes the provider landing page. */
    readonly homeSiteId: string;

    /** Provider-specific Explorer search wording. */
    readonly search: DocProviderSearchConfig;

    /** Ordered immutable site catalog rendered by this provider instance. */
    readonly sites: readonly DocSiteConfig[];
}

/** Ordered user-owned state for one immutable catalog site. */
export interface DocSiteData {
    /** Authoritative pinned targets and fallback order for unplaced pages. */
    pinnedPages: string[];

    /** Optional user-defined ordered pin subsets. Book sources ignore these. */
    collections?: PageCollections;
}

/** Persisted Doc-provider state keyed by stable configured site ID. */
export interface DocProviderData {
    /** Site state is optional so an empty provider store remains valid. */
    sites?: Record<string, DocSiteData>;
}

/** Reactive context specialized to a Doc provider's persisted data. */
export type DocProviderContext = ProviderContext<DocProviderData>;

/** Accepted Doc navigation paired with its site and canonical page identity. */
interface DocPageTarget extends ResolvedDocPage {
    /** Site configuration that accepted the navigation. */
    readonly site: DocSiteConfig;
}

/** Validated immutable configuration and its precomputed lookup state. */
interface DocProviderRuntime {
    /** Stable site order captured when the provider is constructed. */
    readonly sites: readonly DocSiteConfig[];

    /** Site lookup used by search activation. */
    readonly siteById: ReadonlyMap<string, DocSiteConfig>;

    /** Canonical home target for every configured site. */
    readonly homeBySiteId: ReadonlyMap<string, DocPageTarget>;

    /** Resolve a navigation only when one configured site safely owns it. */
    readonly resolvePage: (input: string) => DocPageTarget | null;
}

/** Provider IDs share the Rust API's safe single-path-segment contract. */
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Construct an isolated documentation provider from a code-owned catalog.
 *
 * Configuration is copied and validated once. All parsing, normalization,
 * page identity, rendering, and persistence callbacks then close over that
 * immutable runtime rather than consulting a process-wide site singleton.
 */
export function createDocProvider(
    config: DocProviderConfig): Provider<DocProviderData> {
    const stableConfig: DocProviderConfig = {
        ...config,
        search: { ...config.search },
        sites: config.sites.map(site => ({ ...site })),
    };
    const runtime = createRuntime(stableConfig);
    const home = getSiteHome(runtime, stableConfig.homeSiteId);

    return {
        id: stableConfig.id,
        name: stableConfig.name,
        icon: stableConfig.icon,
        homeUrl: home.url,
        renderItemNameAsCode: false,
        renderPageNameAsCode: false,
        ownsUrl: url => runtime.resolvePage(url) !== null,
        render: ctx => render(ctx, stableConfig, runtime),
    };
}

/** Validate one provider configuration and precompute its stable home pages. */
function createRuntime(config: DocProviderConfig): DocProviderRuntime {
    if (!PROVIDER_ID_PATTERN.test(config.id)) {
        throw new Error(
            `Doc provider ID "${config.id}" is not a valid provider identifier.`);
    }
    if (!config.name.trim())
        throw new Error(`Doc provider "${config.id}" must have a display name.`);
    if (config.sites.length === 0)
        throw new Error(`Doc provider "${config.id}" must configure at least one site.`);

    const siteById = new Map<string, DocSiteConfig>();
    for (const site of config.sites) {
        if (!site.id.trim()) {
            throw new Error(
                `Doc provider "${config.id}" contains a site with an empty ID.`);
        }
        if (!site.name.trim()) {
            throw new Error(
                `Doc site "${site.id}" in provider "${config.id}" must have a name.`);
        }
        if (siteById.has(site.id)) {
            throw new Error(
                `Doc provider "${config.id}" contains duplicate site ID "${site.id}".`);
        }
        siteById.set(site.id, site);
    }
    if (!siteById.has(config.homeSiteId)) {
        throw new Error(
            `Doc provider "${config.id}" has unknown home site "${config.homeSiteId}".`);
    }

    const resolvePage = createPageResolver(config.sites);
    const homeBySiteId = new Map<string, DocPageTarget>();
    for (const site of config.sites) {
        const home = resolvePage(site.homeUrl);
        if (!home || home.siteId !== site.id) {
            throw new Error(
                `Doc site "${site.id}" does not own its home URL "${site.homeUrl}".`);
        }
        homeBySiteId.set(site.id, home);
    }

    return {
        sites: config.sites,
        siteById,
        homeBySiteId,
        resolvePage,
    };
}

/** Build the safe URL pipeline shared by provider ownership and rendering. */
function createPageResolver(
    sites: readonly DocSiteConfig[]): (input: string) => DocPageTarget | null {
    return (input: string): DocPageTarget | null => {
        let url: URL;
        try {
            url = new URL(input);
        } catch {
            return null;
        }
        if (!isSafeDocUrl(url)) return null;

        try {
            const site = sites.find(candidate => candidate.ownsUrl(url));
            if (!site) return null;

            site.normalizeUrl?.(url);
            url.searchParams.sort();
            if (!isSafeDocUrl(url) || !site.ownsUrl(url)) return null;

            const identity = site.resolvePageIdentity
                ? site.resolvePageIdentity(new URL(url.href))
                : defaultPageIdentity(url);
            if (!identity) return null;
            return { site, siteId: site.id, url: url.href, identity };
        } catch {
            // Configuration policies are code-owned, but navigation handling
            // still treats an unexpected policy failure as an unsupported URL.
            return null;
        }
    };
}

/** Require encrypted credential-free documentation targets. */
function isSafeDocUrl(url: URL): boolean {
    return url.protocol === "https:" && !url.username && !url.password;
}

/** Use the canonical page URL without its section as the default identity. */
function defaultPageIdentity(url: URL): string {
    const identity = new URL(url.href);
    identity.hash = "";
    return identity.href;
}

/** Return a validated site home without non-null assertions at call sites. */
function getSiteHome(
    runtime: DocProviderRuntime,
    siteId: string): DocPageTarget {
    const home = runtime.homeBySiteId.get(siteId);
    if (!home) {
        throw new Error(
            `Validated Doc provider runtime is missing home site "${siteId}".`);
    }
    return home;
}

/** Derive the immutable site catalog and its user-owned page state. */
function render(
    ctx: DocProviderContext,
    config: DocProviderConfig,
    runtime: DocProviderRuntime): ProviderOutput {
    const currentTarget = runtime.resolvePage(ctx.currentUrl);
    const items = Object.fromEntries(runtime.sites.map(site => [
        site.id,
        renderSite(ctx, site, currentTarget, runtime),
    ]));

    return {
        items,
        search: {
            placeholder: config.search.placeholder,
            activeItemId: currentTarget?.siteId,
            selectItem(itemId: string) {
                const site = runtime.siteById.get(itemId);
                if (site) ctx.navigateTo(getSiteHome(runtime, site.id).url);
            },
            getAddAction: () => null,
            invalidText: config.search.invalidText,
        },
    };
}

/** Render the site's pages, then apply its exclusive organization policy. */
function renderSite(
    ctx: DocProviderContext,
    site: DocSiteConfig,
    currentTarget: DocPageTarget | null,
    runtime: DocProviderRuntime): Item {
    const home = getSiteHome(runtime, site.id);
    const currentIdentity = currentTarget?.siteId === site.id
        ? currentTarget.identity
        : null;
    const pinnedPages = readPinnedPages(ctx, site, runtime);
    const pinnedIdentities = new Set(pinnedPages.flatMap(page => {
        const target = runtime.resolvePage(page);
        return target ? [target.identity] : [];
    }));

    const pages: Page[] = [{
        name: { type: "text", text: "Home" },
        sortKey: "",
        url: home.url,
        current: currentIdentity === home.identity,
        pinned: null,
        setPinned: () => {},
    }];

    for (const [index, url] of pinnedPages.entries()) {
        const target = runtime.resolvePage(url);
        if (!target) continue;
        pages.push({
            name: { type: "text", text: resolvePageName(site, target, home) },
            sortKey: index.toString().padStart(8, "0"),
            url,
            current: target.identity === currentIdentity,
            pinned: true,
            setPinned(pinned: boolean) {
                if (pinned) return;
                writePinnedPages(
                    ctx,
                    site,
                    readPinnedPages(ctx, site, runtime).filter(page =>
                        runtime.resolvePage(page)?.identity !== target.identity),
                    runtime);
            },
        });
    }

    if (isUnpinnedPreview(currentTarget, site, home, pinnedIdentities)) {
        pages.push({
            name: {
                type: "text",
                text: resolvePageName(site, currentTarget, home),
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
                    [...readPinnedPages(ctx, site, runtime), currentTarget.url],
                    runtime);
            },
        });
    }

    return {
        id: site.id,
        name: site.name,
        sortKey: site.name,
        pages,
        pageLayout: site.organization.type === "provider-sections"
            ? createSectionLayout(pages, site.organization.resolvePagePlacement)
            : createCollectionLayout(pages, () => {
                const pinnedPages = readPinnedPages(ctx, site, runtime);
                return {
                    pinnedPages,
                    collections: normalizePageCollections(
                        pinnedPages, ctx.data.sites?.[site.id]?.collections, runtime.resolvePage),
                };
            }, state => {
                ctx.data.sites ??= {};
                ctx.data.sites[site.id] = state;
            }, runtime.resolvePage),
    };
}

/** Derive a compact page label after central handling of the fixed home row. */
function resolvePageName(
    site: DocSiteConfig,
    target: DocPageTarget,
    home: DocPageTarget): string {
    if (target.identity === home.identity) return "Home";
    try {
        return site.resolvePageName(new URL(target.url)).trim() || "Page";
    } catch {
        return "Unknown page";
    }
}

/** Check whether the accepted navigation needs a temporary preview row. */
function isUnpinnedPreview(
    currentTarget: DocPageTarget | null,
    site: DocSiteConfig,
    home: DocPageTarget,
    pinnedIdentities: ReadonlySet<string>): currentTarget is DocPageTarget {
    return currentTarget?.siteId === site.id &&
        currentTarget.identity !== home.identity &&
        !pinnedIdentities.has(currentTarget.identity);
}

/** Read a sanitized view without mutating during provider render derivation. */
function readPinnedPages(
    ctx: DocProviderContext,
    site: DocSiteConfig,
    runtime: DocProviderRuntime): string[] {
    const home = getSiteHome(runtime, site.id);
    return normalizePinnedPages(
        site.id,
        home.identity,
        ctx.data.sites?.[site.id]?.pinnedPages ?? [],
        runtime.resolvePage);
}

/** Persist a sanitized ordered page list, lazily creating site storage. */
function writePinnedPages(
    ctx: DocProviderContext,
    site: DocSiteConfig,
    pages: readonly string[],
    runtime: DocProviderRuntime): void {
    ctx.data.sites ??= {};
    ctx.data.sites[site.id] ??= { pinnedPages: [] };
    ctx.data.sites[site.id].pinnedPages = normalizePinnedPages(
        site.id,
        getSiteHome(runtime, site.id).identity,
        pages,
        runtime.resolvePage);
    if (site.organization.type === "user-collections" && ctx.data.sites[site.id].collections) {
        ctx.data.sites[site.id].collections = normalizePageCollections(
            ctx.data.sites[site.id].pinnedPages,
            ctx.data.sites[site.id].collections,
            runtime.resolvePage);
    }
}
