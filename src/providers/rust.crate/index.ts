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
/**
 * Builds the list of versions to display in the selector.
 *
 * Order:
 * 1. "latest" (special)
 * 2. Latest version from each of the 5 most recent version groups
 * 3. Current version if not already in the list
 */
function getDisplayVersions(
    currentVersion: string,
    versionGroups: ReadonlyDeep<CrateCache["versionGroups"]> | undefined,
): string[] {
    const versions = ["latest"];
    const seen = new Set(["latest"]);

    // Add latest from each version group (max 5)
    for (const group of versionGroups?.slice(0, 5) ?? []) {
        const latestInGroup = group.versions[0] ?? null;
        if (latestInGroup &&
            !seen.has(latestInGroup.num) &&
            !latestInGroup.yanked) {
            versions.push(latestInGroup.num);
            seen.add(latestInGroup.num);
        }
    }

    // Add current version if not already included
    if (!seen.has(currentVersion)) {
        versions.push(currentVersion);
    }

    return versions;
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

/**
 * Dropdown menu for crate actions: move to group, refresh metadata, remove.
 */
export default function CrateMenu(props: {
    crate: ReadonlyDeep<ItemCrate>;
    removeItem: () => void;
}) {
    const app = useAppContext();
    const crate = props.crate;
    const crateCache = app.getCrateCache(crate.name);

    function moveCrate(targetGroupIndex: number) {
        const newItem: Item = {
            type: "crate",
            name: crate.name,
            expanded: crate.expanded,
            pinnedPages: [...crate.pinnedPages],
            currentVersion: crate.currentVersion,
        };

        app.updateWorkspace(draft => {
            draft.groups[targetGroupIndex]!.items.push(newItem);
        });

        // Remove from current location after adding to new location
        props.removeItem();
    }

    function refreshMetadata() {
        app.refreshCrateCache(crate.name);
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 border rounded-sm hover:bg-input/50 cursor-pointer">
                    <FontAwesomeIcon icon={faEllipsisVertical} size="sm" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <CrateMenuLink text="Crates.io" url={`https://crates.io/crates/${crate.name}`} />
                <CrateMenuLink text="Repository" url={crateCache?.repository ?? null} />
                <CrateMenuLink text="Homepage" url={crateCache?.homepage ?? null} />
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer">
                        <FontAwesomeIcon icon={faRightToBracket} size="sm" />
                        <span>Move to group</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        {app.workspace.groups.map((group, index) => (
                            <CrateMenuItem
                                key={index}
                                text={group.name}
                                action={() => moveCrate(index)} />
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <CrateMenuItem
                    icon={faRotate}
                    text="Refresh metadata"
                    action={refreshMetadata} />
                <DropdownMenuSeparator />
                <CrateMenuItem
                    icon={faTrash}
                    text="Remove crate"
                    variant="destructive"
                    action={props.removeItem} />
            </DropdownMenuContent>
        </DropdownMenu>);
}

function parseSymbolType(prefix: string): SymbolType {
    switch (prefix) {
        case "constant": return "constant";
        case "enum": return "enum";
        case "fn": return "fn";
        case "macro": return "macro";
        case "struct": return "struct";
        case "trait": return "trait";
        case "type": return "type";
        default: return "unknown";
    }
}

/** Parses path segments into module path, symbol name, and type. */
function parseSymbol(segments: ReadonlyDeep<string[]>): ReadonlyDeep<CrateSymbol> {
    if (segments.length === 0) {
        return { symbolType: "unknown", path: "" };
    }

    if (segments.length === 1) {
        // Root module page (e.g., ["tokio"])
        return { symbolType: "module", modulePath: [segments[0]!] };
    }

    const modulePath = segments.slice(0, -1);
    const fileName = segments.at(-1)!;

    // Module page with index.html (e.g., ["tokio", "runtime", "index.html"])
    if (fileName === "index.html")
        return { symbolType: "module", modulePath };

    // Symbol: {prefix}.{name}.html (e.g., "struct.Vec3.html")
    const dotParts =
        fileName
            .slice(0, -".html".length)
            .split(".");
    if (dotParts.length === 2) {
        const [prefix, symbolName] = dotParts as [string, string];
        const symbolType = parseSymbolType(prefix);
        if (symbolType !== "unknown")
            return { symbolType, modulePath, symbolName };
    }

    // Unknown - not a recognized pattern
    return { symbolType: "unknown", path: segments.join("/") };
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
