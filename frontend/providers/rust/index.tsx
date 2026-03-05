import type { ReadonlyDeep } from "type-fest";
import * as _ from "remeda";
import * as semver from "semver";

import { faTrash } from "@fortawesome/free-solid-svg-icons";

import type {
    Provider,
    ProviderContext,
    ProviderOutput,
    Item,
    ItemLink,
    ItemAction,
    ItemVersions,
    Page,
    PageName,
    IdentType,
} from "@/core/data";

import { parseUrl, buildUrl, getBaseUrlForCrate } from "./url";
import { getImportCratesAction } from "./import";

const RustProvider:
    Provider<
        RustProviderData,
        RustProviderCache> = {
    id: "rust",
    name: "Rust",
    enableItemGrouping: true,
    renderItemNameAsCode: true,
    render,
};

export default RustProvider;

export type RustProviderContext =
    ProviderContext<
        RustProviderData,
        RustProviderCache>;

export interface RustProviderData {
    crates: Record<string, CrateData>;
}

/** Cached metadata for a single crate, fetched from crates.io API via the
 *  HTTP proxy. Stored in-memory only — the proxy's SQLite cache handles
 *  persistence and freshness. */
export interface CrateCache {
    name: string;
    versions: { num: string; yanked: boolean }[];
    versionGroups: { versions: { num: string; yanked: boolean }[] }[];
    homepage: string | null;
    repository: string | null;
    documentation: string | null;
}

/** In-memory cache shape for the Rust provider. */
export interface RustProviderCache {
    crates: Record<string, CrateCache>;
}

export interface CrateData {
    /** Currently selected version */
    currentVersion: string;

    /**
     * List of pinned docs.rs pages.
     *
     * Each entry is a relative path (e.g., "glam/struct.Vec3.html").
     * The full URL can be constructed as:
     * `https://docs.rs/{crate_name}/{version}/{path}`.
     **/
    pinnedPages: string[];
}

function handleCurrentUrl(ctx: RustProviderContext) {
    const currentUrl = parseUrl(ctx.currentUrl);
    if (!currentUrl) return;

    if (ctx.currentUrl !== buildUrl(currentUrl)) {
        // Normalize currentUrl — re-navigation always hits proxy cache.
        ctx.navigateTo(buildUrl(currentUrl));
        return;
    }

    const crateName = currentUrl.name;
    const crate = ctx.data.crates?.[crateName];
    if (crate) {
        if (currentUrl.version !== crate.currentVersion) {
            // If version is specified in the URL, update the crate's
            // currentVersion accordingly.
            const newVersion = currentUrl.version;
            ctx.updateData(draft => {
                const crate = draft.crates[crateName];
                if (crate) {
                    crate.currentVersion = newVersion;
                }
            });
        }
    } else {
        // The crate of the current URL is not contained in `data.crates`.
        ctx.updateData(draft => {
            draft.crates ??= {};
            draft.crates[crateName] = {
                currentVersion: currentUrl.version ?? "latest",
                pinnedPages: [],
            };
        });
    }
}

function render(ctx: RustProviderContext): ProviderOutput {
    handleCurrentUrl(ctx);

    // Batch-fetch metadata for all uncached crates in a single request.
    // Individual getCrateCache() calls below will skip crates already
    // covered by this batch (they're in inFlight).
    const uncached = Object.keys(ctx.data.crates ?? {}).filter(name =>
        !ctx.cache.crates?.[name]
        && !inFlight.has(name)
        && getBaseUrlForCrate(name) !== "https://doc.rust-lang.org/");
    if (uncached.length > 1) {
        for (const name of uncached) inFlight.add(name);
        batchFetchCrateCache(ctx, uncached);
    }

    const items =
        _.mapToObj(_.entries(ctx.data.crates ?? {}), pair => {
            const [crateName, crateData] = pair;
            const crateCache =
                getCrateCache(ctx, crateName);
            const crateItem =
                renderItem(
                    ctx,
                    crateName,
                    crateData,
                    crateCache);
            return [crateName, crateItem];
        });

    return {
        items,
        actions: [
            getImportCratesAction(ctx),
        ],
    };
}

function renderItem(
    ctx: RustProviderContext,
    crateName: string,
    crateData: ReadonlyDeep<CrateData>,
    crateCache: ReadonlyDeep<CrateCache> | null,
): Item {
    function getSortKey(name: string): string {
        switch (name) {
            case "std":
                return " _0";
            case "core":
                return " _1";
            case "alloc":
                return " _2";
            case "proc-macro":
                return " _3";
            default:
                return name;
        }
    }

    function getCrateVersions(): ItemVersions | undefined {
        switch (getBaseUrlForCrate(crateName)) {
            case "https://doc.rust-lang.org/":
                // Standard library crates: stable/nightly versions.
                return {
                    current: crateData.currentVersion,
                    recommended: ["stable", "nightly"],
                    all: [["stable", "nightly"]],
                    setCurrentVersion,
                };
            case "https://microsoft.github.io/windows-docs-rs/doc/":
                // Windows crate: only "latest" (docs URL doesn't support versioning).
                return undefined;
            default:
                // Regular docs.rs crates: show versions from cache.
                return crateCache
                    ? getCrateVersionsFromCache(crateData, crateCache, setCurrentVersion)
                    : undefined;
        }
    }

    function setCurrentVersion(newVersion: string) {
        const currentUrl = parseUrl(ctx.currentUrl);
        if (currentUrl && currentUrl.name === crateName) {
            ctx.navigateTo(buildUrl({
                baseUrl: getBaseUrlForCrate(crateName),
                name: crateName,
                version: newVersion,
                pathSegments: currentUrl.pathSegments,
            }));
        } else {
            ctx.updateData(draft => {
                const crate = draft.crates[crateName];
                if (crate) {
                    crate.currentVersion = newVersion;
                }
            });
        }
    }

    return {
        id: crateName,
        name: crateName,
        sortKey: getSortKey(crateName),
        pages:
            getCratePages(ctx, crateName, crateData),
        links:
            crateCache
                ? getCrateLinks(crateName, crateCache)
                : undefined,
        actions:
            getCrateActions(ctx, crateName),
        versions:
            getCrateVersions(),
    };
}

function getCrateVersionsFromCache(
    crateData: ReadonlyDeep<CrateData>,
    crateCache: ReadonlyDeep<CrateCache>,
    setCurrentVersion: (version: string) => void): ItemVersions {
    const versions = crateCache.versionGroups;

    const recommended =
        versions
            .slice(0, 5)
            .map(group => group.versions[0]?.num)
            .filter(version => version)
            // biome-ignore lint/style/noNonNullAssertion: filtered above.
            .map(version => version!);
    if (crateData.currentVersion !== "latest" &&
        !recommended.includes(crateData.currentVersion)) {
        recommended.push(crateData.currentVersion);
    }

    recommended.sort((a, b) => semver.rcompare(a, b));
    recommended.unshift("latest");

    return {
        current: crateData.currentVersion,
        recommended,
        all: [
            ["latest"],
            ...versions.map(({ versions }) => (
                versions
                    .filter(version => !version.yanked)
                    .map(version => version.num))),
        ],
        setCurrentVersion,
    }
}

function getCrateLinks(
    crateName: string,
    crateCache: ReadonlyDeep<CrateCache>): ItemLink[] {
    const links: ItemLink[] = [];

    links.push({
        name: "Crates.io",
        url: `https://crates.io/crates/${crateName}`,
    });

    if (crateCache.homepage) {
        links.push({
            name: "Homepage",
            url: crateCache.homepage,
        });
    }

    if (crateCache.repository) {
        links.push({
            name: "Repository",
            url: crateCache.repository,
        });
    }

    return links;
}

function getCrateActions(
    ctx: RustProviderContext,
    crateName: string): ItemAction[] {
    return [
        {
            name: "Delete Crate",
            icon: { type: "fontawesome", name: faTrash },
            destructive: true,
            invoke: () => ctx.updateData(draft => {
                delete draft.crates[crateName];
            }),
        },
    ];
}

function getCratePages(
    ctx: RustProviderContext,
    crateName: string,
    crateData: ReadonlyDeep<CrateData>): Page[] {
    function getPageNameFromPath(path: string): PageName {
        function createSymbol(segments: string[], type: IdentType): PageName {
            return {
                type: "symbol",
                separator: "::",
                path: [
                    ...segments
                        .slice(0, -1)
                        .map(segment => ({
                            type: "namespace",
                            name: segment,
                        } as const)),
                    // biome-ignore lint/style/noNonNullAssertion: assumes segments.length > 0.
                    { type, name: segments.at(-1)! }
                ]
            };
        }

        function getIdentTypeFromFileNamePrefix(prefix: string): IdentType {
            switch (prefix) {
                case "constant":
                    return "constant";
                case "fn":
                    return "function";
                case "trait":
                    return "interface";
                case "struct":
                case "type":
                case "enum":
                case "union":
                case "primitive":
                    return "type";
                case "attr":
                case "macro":
                case "derive":
                    return "macro";
                default:
                    return "unknown";
            }
        }

        const segments = path.split("/").filter(s => s !== "");
        const fileName = segments.at(-1);

        if (!segments[0]) {
            // This should not happen as all path should contain the root module.
            return { type: "text", text: "<empty>" };
        }

        // Module page without index.html (e.g., ["tokio", "runtime"])
        if (!fileName || !fileName.endsWith(".html")) {
            return createSymbol(segments, "namespace");
        }

        // Module page with index.html (e.g., ["tokio", "runtime", "index.html"])
        if (fileName === "index.html") {
            return createSymbol(segments.slice(0, -1), "namespace");
        }

        // Symbol: {prefix}.{name}.html (e.g., "struct.Vec3.html")
        const dotParts =
            fileName
                .slice(0, -".html".length)
                .split(".");
        if (dotParts.length === 2) {
            const [prefix, identName] = dotParts as [string, string];
            const symbolType = getIdentTypeFromFileNamePrefix(prefix);
            if (symbolType !== "unknown")
                return createSymbol(
                    [...segments.slice(0, -1), identName],
                    symbolType);
        }

        // Unknown - not a recognized pattern
        console.warn(`Unrecognized page path: ${path}`);
        return { type: "text", text: "<error>" };
    }

    /** Builds a URL for the given path within this crate. */
    function buildPageUrl(pathSegments: string[]): string {
        return buildUrl({
            baseUrl: getBaseUrlForCrate(crateName),
            name: crateName,
            version: crateData.currentVersion,
            pathSegments,
        });
    }

    const currentUrl = parseUrl(ctx.currentUrl);

    // Both docs.rs and doc.rust-lang.org paths include the crate/module name:
    // - docs.rs: "tokio/runtime/..."
    // - doc.rust-lang.org: "std/vec/..."
    const rootModuleName = crateName.replaceAll("-", "_");
    const rootModulePath = `${rootModuleName}/`;

    // Check if currentPage belongs to this crate.
    // For docs.rs: same name and version.
    // For doc.rust-lang.org: same name (no version).
    const isThisCrate =
        currentUrl &&
        currentUrl.name === crateName;
    const currentPath =
        isThisCrate ? currentUrl.pathSegments.join("/") : null;

    const pages: Page[] = [];
    for (const path of crateData.pinnedPages) {
        const url = buildPageUrl(path.split("/"));
        const name = getPageNameFromPath(path);
        const sortKey =
            name.type === "symbol"
                ? name.path.map(segment => segment.name).join("::")
                : name.text;
        pages.push({
            name,
            sortKey,
            url,
            pinned: true,
            setPinned(pinned: boolean) {
                if (pinned) return; // already pinned.
                ctx.updateData(draft => {
                    const crate = draft.crates[crateName];
                    if (!crate) return;
                    crate.pinnedPages =
                        crate.pinnedPages.filter(p => p !== path);
                });
            },
        });
    }

    // Root module page (always present, pinning disabled).
    // For std crates, rootModulePath is empty, so we pass empty array to buildPageUrl.
    pages.push({
        name: { type: "text", text: rootModuleName },
        sortKey: rootModulePath,
        url: buildPageUrl([rootModuleName]),
        pinned: null,
        setPinned: _ => {},
    });

    // Add preview page if viewing this crate and the path is not root and not pinned
    if (currentPath &&
        currentPath !== rootModulePath &&
        !crateData.pinnedPages.includes(currentPath)) {
        const name = getPageNameFromPath(currentPath);
        const sortKey =
            name.type === "symbol"
                ? name.path.map(segment => segment.name).join("::")
                : name.text;
        pages.push({
            name,
            sortKey,
            url: ctx.currentUrl,
            pinned: false,
            setPinned(pinned: boolean) {
                if (!pinned) return; // already unpinned.
                ctx.updateData(draft => {
                    const crate = draft.crates[crateName];
                    if (!crate) return;
                    crate.pinnedPages ??= [];
                    crate.pinnedPages.push(currentPath);
                    crate.pinnedPages.sort();
                });
            },
        });
    }

    return pages;
}

import * as CratesAPI from "./crates-api";
import * as Utils from "@/utils/version-group";

/** Crate names with a fetch currently in flight, preventing duplicate
 *  requests when React re-renders before the first fetch completes. */
const inFlight = new Set<string>();

/** Return cached crate metadata, fetching through the HTTP proxy if not yet
 *  in the in-memory cache. Returns null for std-library crates (not on
 *  crates.io) or when the first fetch is still in flight. */
function getCrateCache(
    ctx: RustProviderContext,
    crateName: string,
): ReadonlyDeep<CrateCache> | null {
    // Standard library crates are not on crates.io — no cache needed.
    if (getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/")
        return null;

    const existing = ctx.cache.crates?.[crateName] ?? null;
    if (!existing && !inFlight.has(crateName)) {
        inFlight.add(crateName);
        fetchCrateCache(ctx, crateName)
            .finally(() => inFlight.delete(crateName));
    }

    return existing;
}

/** Convert a CrateInfo response into a CrateCache entry. */
function crateInfoToCache(crateInfo: CratesAPI.CrateInfo): CrateCache {
    return {
        name: crateInfo.crate.name,
        versions: crateInfo.versions,
        versionGroups: Utils.computeVersionGroups(crateInfo.versions),
        repository: crateInfo.crate.repository ?? null,
        homepage: crateInfo.crate.homepage ?? null,
        documentation: crateInfo.crate.documentation ?? null,
    };
}

/** Fetch crate metadata from crates.io (via HTTP proxy) and store in the
 *  in-memory cache. Errors are logged but non-fatal. */
async function fetchCrateCache(
    ctx: RustProviderContext,
    crateName: string,
): Promise<void> {
    console.log(`Fetching crate info for ${crateName}.`);
    try {
        const crateInfo = await CratesAPI.fetchCrateInfo(crateName);
        ctx.updateCache(draft => {
            draft.crates ??= {};
            draft.crates[crateName] = crateInfoToCache(crateInfo);
        });
    } catch (err) {
        console.error(`Failed to fetch crate info for ${crateName}:`, err);
    }
}

/** Batch-fetch crate metadata from the server's HTTP cache, then fall back
 *  to individual proxy requests for cache misses. Called once on provider
 *  load when multiple crates need metadata. */
async function batchFetchCrateCache(
    ctx: RustProviderContext,
    names: string[],
): Promise<void> {
    try {
        const cached = await CratesAPI.fetchCratesInfo(names);

        // Populate in-memory cache with hits.
        const hits = Object.keys(cached);
        if (hits.length > 0) {
            ctx.updateCache(draft => {
                draft.crates ??= {};
                for (const name of hits)
                    draft.crates[name] = crateInfoToCache(cached[name]);
            });
        }

        // Fall back to individual proxy fetches for misses.
        const misses = names.filter(n => !(n in cached));
        if (misses.length > 0)
            console.log(`[crates.io] ${hits.length} cache hits, ${misses.length} misses — fetching individually.`);
        for (const name of misses)
            fetchCrateCache(ctx, name).finally(() => inFlight.delete(name));
    } catch (err) {
        console.error("Batch crate fetch failed, falling back to individual fetches:", err);
        for (const name of names)
            fetchCrateCache(ctx, name).finally(() => inFlight.delete(name));
    }
}
