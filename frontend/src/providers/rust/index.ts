import type { ReadonlyDeep } from "type-fest";
import * as semver from "semver";

import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Plus from "@lucide/svelte/icons/plus";

import type {
    Provider,
    ProviderContext,
    ProviderOutput,
    ProviderAction,
    Item,
    ItemLink,
    ItemAction,
    ItemVersions,
    Page,
    PageName,
    IdentType,
} from "@/core/data";

import { parseUrl, buildUrl, getBaseUrlForCrate } from "./url";
import { setupRustEffects } from "./effects.svelte";
import {
    type CrateCache,
    getCrateCache,
    deleteCrateCache,
    inFlight,
    batchFetchCrateCache,
} from "./cache.svelte";

// Re-export for downstream consumers (effects, cache modules need the type).
export type { CrateCache };

export type RustProviderContext = ProviderContext<RustProviderData>;

export interface RustProviderData {
    crates: Record<string, CrateData>;
}

export interface CrateData {
    /** Currently selected version. */
    currentVersion: string;

    /**
     * List of pinned docs.rs pages.
     *
     * Each entry is a relative path (e.g., "glam/struct.Vec3.html").
     * The full URL can be constructed as:
     * `https://docs.rs/{crate_name}/{version}/{path}`.
     */
    pinnedPages: string[];
}

const RustProvider: Provider<RustProviderData> = {
    id: "rust",
    name: "Rust",
    enableItemGrouping: true,
    renderItemNameAsCode: true,
    render,
    setupEffects: setupRustEffects,
};

export default RustProvider;

function render(ctx: RustProviderContext): ProviderOutput {
    const items: Record<string, Item> = {};
    for (const [crateName, crateData] of Object.entries(ctx.data.crates ?? {})) {
        const crateCache = getCrateCache(crateName);
        items[crateName] = renderItem(ctx, crateName, crateData, crateCache);
    }
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
            case "std":        return " _0";
            case "core":       return " _1";
            case "alloc":      return " _2";
            case "proc-macro": return " _3";
            default:           return name;
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
            const crate = ctx.data.crates[crateName];
            if (crate) crate.currentVersion = newVersion;
        }
    }

    return {
        id: crateName,
        name: crateName,
        sortKey: getSortKey(crateName),
        pages: getCratePages(ctx, crateName, crateData),
        links: crateCache ? getCrateLinks(crateName, crateCache) : undefined,
        actions: getCrateActions(ctx, crateName),
        versions: getCrateVersions(),
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
            .filter((version): version is string => Boolean(version));
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
    };
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
        links.push({ name: "Homepage", url: crateCache.homepage });
    }

    if (crateCache.repository) {
        links.push({ name: "Repository", url: crateCache.repository });
    }

    return links;
}

function getCrateActions(
    ctx: RustProviderContext,
    crateName: string): ItemAction[] {
    const actions: ItemAction[] = [];

    // Refresh metadata — only for crates.io crates (std-library crates
    // don't have crates.io metadata to refresh).
    if (getBaseUrlForCrate(crateName) !== "https://doc.rust-lang.org/") {
        actions.push({
            name: "Refresh Metadata",
            icon: { type: "lucide", icon: RotateCw },
            invoke: () => {
                deleteCrateCache(crateName);
                inFlight.delete(crateName);
                void batchFetchCrateCache([crateName], true);
            },
        });
    }

    actions.push({
        name: "Delete Crate",
        icon: { type: "lucide", icon: Trash2 },
        destructive: true,
        invoke: () => { delete ctx.data.crates[crateName]; },
    });

    return actions;
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
                    { type, name: segments.at(-1)! },
                ],
            };
        }

        function getIdentTypeFromFileNamePrefix(prefix: string): IdentType {
            switch (prefix) {
                case "constant": return "constant";
                case "fn":       return "function";
                case "trait":    return "interface";
                case "struct":
                case "type":
                case "enum":
                case "union":
                case "primitive": return "type";
                case "attr":
                case "macro":
                case "derive":   return "macro";
                default:         return "unknown";
            }
        }

        const segments = path.split("/").filter(s => s !== "");
        const fileName = segments.at(-1);

        if (!segments[0]) {
            // This should not happen as all paths should contain the root module.
            return { type: "text", text: "<empty>" };
        }

        // Module page without index.html (e.g., ["tokio", "runtime"]).
        if (!fileName || !fileName.endsWith(".html")) {
            return createSymbol(segments, "namespace");
        }

        // Module page with index.html (e.g., ["tokio", "runtime", "index.html"]).
        if (fileName === "index.html") {
            return createSymbol(segments.slice(0, -1), "namespace");
        }

        // Symbol: {prefix}.{name}.html (e.g., "struct.Vec3.html").
        const dotParts = fileName.slice(0, -".html".length).split(".");
        if (dotParts.length === 2) {
            const [prefix, identName] = dotParts as [string, string];
            const symbolType = getIdentTypeFromFileNamePrefix(prefix);
            if (symbolType !== "unknown")
                return createSymbol(
                    [...segments.slice(0, -1), identName],
                    symbolType);
        }

        console.warn(`Unrecognized page path: ${path}`);
        return { type: "text", text: "<error>" };
    }

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

    const isThisCrate = currentUrl && currentUrl.name === crateName;
    const currentPath = isThisCrate ? currentUrl.pathSegments.join("/") : null;

    const pages: Page[] = [];
    for (const path of crateData.pinnedPages) {
        const url = buildPageUrl(path.split("/"));
        const name = getPageNameFromPath(path);
        const sortKey = name.type === "symbol"
            ? name.path.map(segment => segment.name).join("::")
            : name.text;
        pages.push({
            name,
            sortKey,
            url,
            pinned: true,
            setPinned(pinned: boolean) {
                if (pinned) return; // already pinned.
                const crate = ctx.data.crates[crateName];
                if (!crate) return;
                crate.pinnedPages = crate.pinnedPages.filter(p => p !== path);
            },
        });
    }

    // Root module page (always present, pinning disabled).
    pages.push({
        name: { type: "text", text: rootModuleName },
        sortKey: rootModulePath,
        url: buildPageUrl([rootModuleName]),
        pinned: null,
        setPinned: _ => {},
    });

    // Add preview page if viewing this crate and the path is not root and not pinned.
    if (currentPath &&
        currentPath !== rootModulePath &&
        !crateData.pinnedPages.includes(currentPath)) {
        const name = getPageNameFromPath(currentPath);
        const sortKey = name.type === "symbol"
            ? name.path.map(segment => segment.name).join("::")
            : name.text;
        pages.push({
            name,
            sortKey,
            url: ctx.currentUrl,
            pinned: false,
            setPinned(pinned: boolean) {
                if (!pinned) return; // already unpinned.
                const crate = ctx.data.crates[crateName];
                if (!crate) return;
                crate.pinnedPages ??= [];
                crate.pinnedPages.push(currentPath);
                crate.pinnedPages.sort();
            },
        });
    }

    return pages;
}

// ============================================================================
// Import action — opens an `"input"` dialog rendered by the Explorer.
// ============================================================================

function getImportCratesAction(ctx: RustProviderContext): ProviderAction {
    return {
        type: "input",
        name: "Import",
        icon: { type: "lucide", icon: Plus },
        dialogTitle: "Import from URLs",
        dialogDescription:
            "Paste crate names or docs.rs / doc.rust-lang.org URLs (one per line) to add crates and pages.",
        placeholder: "https://docs.rs/tokio/latest/tokio/...",
        multiline: true,
        confirmLabel: "Import",
        invoke(text: string) {
            const lines = text
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0);

            // Parse URLs and group them by crate name; bare crate names (e.g.
            // "anyhow") add the crate without any pinned pages.
            const importCrates: Record<string, string[]> = {};
            for (const line of lines) {
                if (line.startsWith("https://")) {
                    const page = parseUrl(line);
                    switch (page?.baseUrl) {
                        case "https://docs.rs/":
                        case "https://doc.rust-lang.org/": {
                            const path = page.pathSegments.join("/");
                            const rootModulePath = `${page.name.replaceAll("-", "_")}/`;

                            // Skip root module paths — they're always shown and cannot be pinned.
                            if (path === rootModulePath) {
                                importCrates[page.name] ??= [];
                                break;
                            }

                            if (!importCrates[page.name]?.includes(path)) {
                                importCrates[page.name] ??= [];
                                importCrates[page.name]?.push(path);
                            }
                            break;
                        }
                        default:
                            console.log(`[ImportCrates] Unsupported URL: ${line}`);
                            break;
                    }
                } else if (/^[a-z0-9_-]+$/i.test(line)) {
                    importCrates[line] ??= [];
                } else {
                    console.log(`[ImportCrates] Invalid input: ${line}`);
                }
            }

            for (const [crateName, newPages] of Object.entries(importCrates)) {
                // Use "stable" for std crates, "latest" for crates.io crates.
                const defaultVersion =
                    getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/"
                        ? "stable"
                        : "latest";
                ctx.data.crates[crateName] ??= {
                    currentVersion: defaultVersion,
                    pinnedPages: [],
                };
                // biome-ignore lint/style/noNonNullAssertion: assigned above.
                const pinnedPages = ctx.data.crates[crateName]!.pinnedPages;
                for (const page of newPages) {
                    if (!pinnedPages.includes(page)) pinnedPages.push(page);
                }
                pinnedPages.sort();
            }
        },
    };
}

