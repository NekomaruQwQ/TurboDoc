import type { ReadonlyDeep } from "type-fest";
import * as _ from "remeda";

import { faTrash } from "@fortawesome/free-solid-svg-icons";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shadcn/components/ui/dialog";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shadcn/components/ui/dropdown-menu";

import type {
    Provider,
    ProviderContext,
    ProviderOutput,
    Item,
    ItemAction,
    Page,
    PageName,
    IdentType,
} from "@/core/data";

import { type KnownUrl, parseUrl, buildUrl } from "./url";

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

type RustCrateProviderContext =
    ProviderContext<
        RustCrateProviderData,
        RustCrateProviderCache>;

interface RustCrateProviderData {
    crates: Record<string, CrateData>;
}

interface RustCrateProviderCache {
    crates: Record<string, CrateCache>;
}

interface CrateData {
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

function handleCurrentUrl(ctx: RustCrateProviderContext) {
    const currentUrl = parseUrl(ctx.currentUrl);
    switch (currentUrl?.baseUrl) {
        case "https://docs.rs/":
            const crateName = currentUrl.crateName;
            const crate = ctx.data.crates[crateName];
            if (crate) {
                // If version is missing, redirect according to the current version
                // of that crate.
                if (!currentUrl.crateVersion) {
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

function render(ctx: RustCrateProviderContext): ProviderOutput {
    handleCurrentUrl(ctx);

    const items =
        _.pipe(
            _.entries(ctx.data.crates),
            _.mapToObj(([crateName, crateData]) => {
                // const pages = renderPages(ctx, crateData);
                return [crateName, {
                    id: crateName,
                    name: crateName,
                    sortKey: crateName,
                    pages: getCratePages(ctx, crateName, crateData),
                    actions: getCrateActions(ctx, crateName),
                }];
            }));

    return {
        items,
    };
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
 const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

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
export function CrateMenu(props: {
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

/** Parses URLs from textarea, groups by crate, and imports items. */
function handleImport() {
    const lines = importText.split("\n").map(line => line.trim()).filter(Boolean);

    // Parse URLs and group by crate name
    const cratePages = new Map<string, string[]>();
    for (const line of lines) {
        const page = parseUrl(line);
        if (page.type !== "crate") continue;

        const paths = cratePages.get(page.crateName) ?? [];
        const pathStr = page.pathSegments.join("/");
        if (pathStr && !paths.includes(pathStr)) {
            paths.push(pathStr);
        }
        cratePages.set(page.crateName, paths);
    }

    // Create Item objects and import
    const items: Item[] = [];
    for (const [crateName, pinnedPages] of cratePages) {
        items.push({
            type: "crate",
            name: crateName,
            currentVersion: "latest",
            pinnedPages,
            expanded: true,
        });
    }

    if (items.length > 0) {
        props.importItems(items);
    }

    setImportText("");
    setShowImportDialog(false);

            {/* Import Dialog */}
    const _ =         (<Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import from URLs</DialogTitle>
                        <DialogDescription>
                            Paste docs.rs URLs (one per line) to add crates and pages.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        placeholder="https://docs.rs/tokio/latest/tokio/..."
                        rows={8}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
                        <Button onClick={handleImport}>Import</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>);
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
