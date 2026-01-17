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

import { parseUrl, buildUrl } from "./url";
import { getImportCratesAction } from "./import";

const RustCrateProvider:
    Provider<
        RustCrateProviderData,
        RustCrateProviderCache> = {
    id: "rust.crate",
    name: "Rust Crates",
    enableItemGrouping: true,
    renderItemNameAsCode: true,
    render,
};

export default RustCrateProvider;

export type RustCrateProviderContext =
    ProviderContext<
        RustCrateProviderData,
        RustCrateProviderCache>;

export interface RustCrateProviderData {
    crates: Record<string, CrateData>;
}

export interface RustCrateProviderCache {
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

export interface CrateCache {
    /** Timestamp when this cache entry was last updated */
    lastFetched: number;
    /** Name of the crate (for validation) */
    name: string;
    /** Full version list fetched from crates.io API */
    versions: { num: string, yanked: boolean } [];
    /** Grouped versions for display */
    versionGroups: { latest: string, versions: { num: string, yanked: boolean }[] }[];
    /** Homepage URL */
    homepage: string | null;
    /** Repository URL */
    repository: string | null;
    /** Documentation URL (might differ from docs.rs) */
    documentation: string | null;
}

function handleCurrentUrl(ctx: RustCrateProviderContext) {
    const currentUrl = parseUrl(ctx.currentUrl);
    switch (currentUrl?.baseUrl) {
        case "https://docs.rs/": {
            const crateName = currentUrl.crateName;
            const crate = ctx.data.crates[crateName];
            if (crate) {
                if (currentUrl.crateVersion) {
                    // If version is specified in the URL, update the crate's
                    // currentVersion accordingly.
                    const newVersion = currentUrl.crateVersion;
                    ctx.updateData(draft => {
                        const crate = draft.crates[crateName];
                        if (crate) {
                            crate.currentVersion = newVersion;
                        }
                    });
                } else {
                    // If version is missing, redirect according to the current
                    // version of that crate.
                    ctx.setCurrentUrl(buildUrl({
                        baseUrl: "https://docs.rs/",
                        crateName,
                        crateVersion: crate.currentVersion,
                        pathSegments: currentUrl.pathSegments,
                    }));
                }
            } else {
                // The crate of the current URL is not contained in `data.crates`.
                ctx.updateData(draft => {
                    draft.crates ??= {};
                    draft.crates[crateName] = {
                        currentVersion: currentUrl.crateVersion ?? "latest",
                        pinnedPages: [],
                    };
                });
            }
            break;
        }
    }
}

function render(ctx: RustCrateProviderContext): ProviderOutput {
    handleCurrentUrl(ctx);

    const items =
        _.mapToObj(_.entries(ctx.data.crates), pair => {
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
    ctx: RustCrateProviderContext,
    crateName: string,
    crateData: ReadonlyDeep<CrateData>,
    crateCache: ReadonlyDeep<CrateCache> | null,
): Item {
    return {
        id: crateName,
        name: crateName,
        sortKey: crateName,
        pages:
            getCratePages(ctx, crateName, crateData),
        links:
            crateCache
                ? getCrateLinks(crateName, crateCache)
                : undefined,
        actions:
            getCrateActions(ctx, crateName),
        versions:
            crateCache
                ? getCrateVersions(
                    crateData,
                    crateCache,
                    newVersion => {
                        const currentUrl = parseUrl(ctx.currentUrl);
                        if (currentUrl &&
                            currentUrl.baseUrl === "https://docs.rs/" &&
                            currentUrl.crateName === crateName) {
                            ctx.setCurrentUrl(buildUrl({
                                baseUrl: "https://docs.rs/",
                                crateName,
                                crateVersion: newVersion,
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
                    })
                : undefined,
    };
}

function getCrateVersions(
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
    ctx: RustCrateProviderContext,
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
    ctx: RustCrateProviderContext,
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
                case "enum":
                    return "type";
                case "fn":
                    return "function";
                case "macro":
                    return "macro";
                case "struct":
                    return "type";
                case "trait":
                    return "interface";
                case "type":
                    return "type";
                default:
                    return "unknown";
            }
        }

        const segments = path.split("/");
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

    const currentUrl = parseUrl(ctx.currentUrl);

    const rootModuleName = crateName.replaceAll("-", "_");
    const rootModulePath = `${rootModuleName}/`;

    // Check if currentPage belongs to this crate (same name and version)
    const isThisCrate =
        currentUrl &&
        currentUrl.baseUrl === "https://docs.rs/" &&
        currentUrl.crateName === crateName &&
        currentUrl.crateVersion === crateData.currentVersion;
    const currentPath =
        isThisCrate ? currentUrl.pathSegments.join("/") : null;

    const pages: Page[] = [];
    for (const path of crateData.pinnedPages) {
        const url = buildUrl({
            baseUrl: "https://docs.rs/",
            crateName,
            crateVersion: crateData.currentVersion,
            pathSegments: path.split("/"),
        });
        pages.push({
            name: getPageNameFromPath(path),
            sortKey: path,
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

    pages.push({
        name: { type: "text", text: rootModuleName },
        sortKey: rootModulePath,
        url: buildUrl({
            baseUrl: "https://docs.rs/",
            crateName,
            crateVersion: crateData.currentVersion,
            pathSegments: [rootModulePath],
        }),
        pinned: null,
        setPinned: _ => {},
    });

    // Add preview page if viewing this crate and the path is not root and not pinned
    if (currentPath &&
        currentPath !== rootModulePath &&
        !crateData.pinnedPages.includes(currentPath)) {
        pages.push({
            name: getPageNameFromPath(currentPath),
            sortKey: currentPath,
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

/// Cache expiry time (24 hours in milliseconds)
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function getCrateCache(
    ctx: RustCrateProviderContext,
    crateName: string,
): ReadonlyDeep<CrateCache> | null {
    async function refetch(
        crateName: string,
        callback: (crateCache: CrateCache) => void,
    ): Promise<void> {
        console.log(`Refetching crate info for ${crateName}.`);
        try {
            const crateInfo = await CratesAPI.fetchCrateInfo(crateName);

            const newCrateInfo = {
                name: crateInfo.crate.name,
                versions: crateInfo.versions,
                versionGroups: Utils.computeVersionGroups(crateInfo.versions),
                repository: crateInfo.crate.repository ?? null,
                homepage: crateInfo.crate.homepage ?? null,
                documentation: crateInfo.crate.documentation ?? null,
                lastFetched: Date.now(),
            } satisfies CrateCache;

            callback(newCrateInfo);
        } catch (err) {
            console.error(`Failed to fetch crate info for ${crateName}:`, err);
        }
    }

    const existing = ctx.cache.crates?.[crateName] ?? null;
    if (!existing || Date.now() - existing.lastFetched > CACHE_EXPIRY_MS) {
        refetch(crateName, crateCache => {
            ctx.updateCache(draft => {
                draft.crates ??= {};
                draft.crates[crateName] = crateCache;
            });
        });
    }

    return existing;
}
