import type { ReadonlyDeep } from "type-fest";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faThumbtack } from "@fortawesome/free-solid-svg-icons";

import { cn } from "@/prelude";

import type { ItemCrate } from "@/data";
import { useAppContext } from "@/context";

type SymbolType =
    | "constant"
    | "enum"
    | "fn"
    | "macro"
    | "module"
    | "struct"
    | "trait"
    | "type"
    | "unknown";

type CrateSymbol =
    | { symbolType: "unknown", path: string }
    | { symbolType: "module", modulePath: string[] }
    | {
        modulePath: string[], // Full module path, e.g., ["glam", "f32"]
        symbolName: string, // Symbol name (e.g., "Vec2")
        symbolType: Exclude<SymbolType, "unknown" | "module">,
    };

interface CratePageInfo {
    path: string;
    symbol: CrateSymbol;
    active: boolean;
    pinned: boolean;
    italic: boolean;
}

/**
 * Displays the list of documentation pages for a crate.
 *
 * Shows:
 * 1. Home link (always first, navigates to crate root)
 * 2. Pinned pages (with unpin icon)
 * 3. Preview page (italic, with pin icon) if currentPage is not pinned
 */
export default function CratePageList(props: {
    crate: ReadonlyDeep<ItemCrate>;
    updateCrate(updater: (crate: ItemCrate) => void): void;
}) {
    const crate = props.crate;
    const pages = createPageList(crate);
    return (
        <div className="flex flex-col">
            {
                pages.map(page => (
                    <CratePageItem
                        key={page.path}
                        page={page}
                        baseUrl={`https://docs.rs/${crate.name}/${crate.currentVersion}/`}
                        updateCrate={props.updateCrate} />))
            }
        </div>);
}

function createPageList(crate: ReadonlyDeep<ItemCrate>): ReadonlyDeep<CratePageInfo>[] {
    const app = useAppContext();
    const currentPage = app.workspace.currentPage;

    const rootModuleName = crate.name.replaceAll("-", "_");
    const rootModulePath = `${rootModuleName}/`;

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

function getSymbolColor(type: SymbolType): string {
    switch (type) {
        case "struct":
        case "enum":
        case "type":
            return "text-[var(--color-yellow)]";
        case "trait":
            return "text-[var(--color-cyan)]";
        case "fn":
            return "text-[var(--color-blue)]";
        case "macro":
        case "constant":
            return "text-[var(--color-orange)]";
        default:
            return "";
    }
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

function CratePageItem(props: {
    page: ReadonlyDeep<CratePageInfo>;
    baseUrl: string;
    updateCrate(updater: (crate: ItemCrate) => void): void;
}) {
    const app = useAppContext();
    const page = props.page;
    const symbol = page.symbol;

    function pin() {
        props.updateCrate(crate => {
            crate.pinnedPages.push(page.path);
        });
    }

    function unpin() {
        props.updateCrate(crate => {
            crate.pinnedPages = crate.pinnedPages.filter(p => p !== page.path);
        });
    }

    return (
        <div
            className={cn(
                "group/page flex items-center rounded w-full px-1 py-px my-px cursor-pointer border",
                page.active
                    ? "bg-input shadow-sm"
                    : "border-transparent hover:bg-input/50",
                page.italic && "italic")}
            onClick={() => app.navigateTo(`${props.baseUrl}${page.path}`)}>
            <span className="flex-1 truncate font-mono font-light">
                {symbol.symbolType === "unknown"
                    ? <span className="text-(--color-red)">{symbol.path}</span>
                    : <span>
                        {/* Module path */}
                        <span>{symbol.modulePath.join("::")}</span>
                        {/* Symbol name */}
                        {symbol.symbolType !== "module" && <>
                            <span>::</span>
                            <span className={getSymbolColor(symbol.symbolType)}>{symbol.symbolName}</span>
                        </>}
                    </span>}
            </span>
            {page.italic && (
                <span
                    className="invisible group-hover/page:visible"
                    onClick={event => { pin(); event.stopPropagation(); }}>
                    <FontAwesomeIcon icon={faThumbtack} size="xs" className="text-foreground/50"/>
                </span>)}
            {page.pinned && (
                <span onClick={event => { unpin(); event.stopPropagation(); }}>
                    <FontAwesomeIcon icon={faThumbtack} size="xs" />
                </span>)}
        </div>);
}
