import type { ReadonlyDeep } from "type-fest";

import type {
    Provider,
    ProviderContext,
    ProviderOutput,
    Item,
    Page,
} from "@/core/data";

import { type CratePage, parseUrl, buildUrl } from "./url";

const RustCrateProvider:
    Provider<
        RustCrateProviderData,
        RustCrateProviderCache> = {
    id: "rust.crate",
    name: "Rust Crates",
    enableItemGrouping: true,
    renderItemNameAsCode: true,

    render,
    importItem,
};

export default RustCrateProvider;

type RustCrateProviderContext =
    ProviderContext<
        RustCrateProviderData,
        RustCrateProviderCache>;

interface RustCrateProviderData {
    crates: CrateData[];
}

interface RustCrateProviderCache {
    crates: Record<string, CrateCache>;
}

interface CrateData {
    /** Name of the crate. */
    name: string;

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

interface CrateCache {
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

function render(provider: RustCrateProviderContext): ProviderOutput {
    return {
        items: renderItems(provider, provider.data.crates),
    };
}

function renderItems(
    provider: RustCrateProviderContext,
    crates: ReadonlyDeep<CrateData[]>):
    ReadonlyDeep<Item[]> {
    return crates.map(crate => ({
        id: crate.name,
        name: crate.name,
        sortKey: crate.name,
        pages: renderPages(provider, crate),
        actions: [],
        versions: renderVersionSelector(),
    }));
}

function renderPages(
    provider: RustCrateProviderContext,
    crate: ReadonlyDeep<CrateData>):
    ReadonlyDeep<Page[]> {
        const currentPage = parseUrl(provider.currentUrl);

        const rootModuleName = crate.name.replaceAll("-", "_");
        const rootModulePath = `${rootModuleName}/`;

        () => {
            switch (currentPage?.baseUrl) {
                case "https://docs.rs/":
                    if (currentPage.crateName === crate.name && (
                        currentPage.crateVersion === null ||
                        currentPage.crateVersion === crate.currentVersion)) {
                        return parseSymbol(currentPage.pathSegments);
                    }
                    break;
            }
        }();

        if (currentPage.type === "unknown") {
            console.warn("CratePageList: currentPage is unknown, cannot create page list.", currentPage);
        }

        // Check if currentPage belongs to this crate (same name and version)
        const isThisCrate =
            currentPage.type === "crate" &&
            currentPage.crateName === crate.name &&
            currentPage.crateVersion === crate.currentVersion;
        const currentPath = isThisCrate ? currentPage.pathSegments.join("/") : null;

        const pages: ReadonlyDeep<CratePageInfo>[] =
            crate.pinnedPages.map(path => ({
                path,
                symbol: parseSymbol(path.split("/")),
                active: currentPath === path,
                pinned: true,
                italic: false,
            }));

        pages.push({
            path: rootModulePath,
            symbol: parseSymbol([rootModuleName]),
            active: currentPath === rootModulePath,
            pinned: false,
            italic: false,
        });

        // Add preview page if viewing this crate and the path is not root and not pinned
        if (isThisCrate &&
            currentPath !== rootModulePath &&
            !crate.pinnedPages.includes(currentPath!)) {
            pages.push({
                path: currentPath!,
                symbol: parseSymbol(currentPage.pathSegments),
                active: true,
                pinned: false,
                italic: true,
            });
        }

        // Sort pages alphabetically by path to ensure consistent order
        pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

        return pages;
}

function renderVersionSelector(

) {

}

function getCrateCache(crateName: string): ReadonlyDeep<CrateCache> | undefined {
/// Cache expiry time (24 hours in milliseconds)
export const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

    function shouldRefetch(crateCache: ReadonlyDeep<CrateCache> | undefined): boolean {
        if (!crateCache) return true;
        const age = Date.now() - crateCache.lastFetched;
        return age > CACHE_EXPIRY_MS;
    }

    async function refetch(crateName: string, callback: (crateCache: CrateCache) => void): Promise<void> {
        console.log(`Refetching crate info for ${crateName}.`);
        try {
            const crateInfo = await CratesAPI.fetchCrateInfo(crateName);

            const newCrateInfo = {
                name: crateInfo.crate.name,
                versions: crateInfo.versions,
                versionGroups: computeVersionGroups(crateInfo.versions),
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

    let existing = this.cache.crates ? this.cache.crates[crateName] : undefined;
    if (shouldRefetch(existing)) {
        refetch(crateName, crateCache => {
            this.updateCache(draft => {
                draft.crates[crateName] = crateCache;
            });
        });
    }

    return existing;
}

function importItem(provider: RustCrateProviderContext, input: string):
    | { readonly success: true }
    | { readonly success: false, readonly message: string } {
    if (input.startsWith("https://docs.rs/")) {
        let [crateName, crateVersion, ...pathSegments] =
            input
                .slice("https://docs.rs/".length)
                .split("/");
        if (!crateName) {
            return { success: false, message: "missing crate name." };
        }

        if (crateName === "crate") {
            return { success: false, message: "docs.rs crate URL not supported." };
        }

        const rootModuleName = crateName.replaceAll("-", "_");
        const rootModulePath = rootModuleName + "/";

        if (pathSegments[0] !== rootModulePath) {
            return { success: false, message: "not under the root module" };
        }

        const crate =
            provider.data.crates.find(item => item.name === crateName);
        if (crate) {
            const path = pathSegments.join("/");
            if (crate.pinnedPages.includes(path)) {
                return { success: false, message: "already exists." };
            }

            provider.updateData(draft => {
                const crate =
                    draft.crates.find(item => item.name === crateName)!;
                crate.pinnedPages ??= [];
                crate.pinnedPages.push(path);
                crate.pinnedPages.sort();
            });
        } else {
            provider.updateData(draft => {
                draft.crates ??= [];
                draft.crates.push({
                    name: crateName,
                    currentVersion: crateVersion ?? "latest",
                    pinnedPages:
                        pathSegments.length > 0
                            ? [pathSegments.join("/")]
                            : [],
                });
                draft.crates.sort((a, b) => a.name.localeCompare(b.name));
            });
        }

        return { success: true };
    }

    return { success: false, message: "unsupported domain." };
}
