import type { ReadonlyDeep } from "type-fest";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faThumbtack } from "@fortawesome/free-solid-svg-icons";

import { cn } from "@/index";

import { useAppContext } from "@/core/context";

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
        <div className="flex flex-col gap-0.5">
            {pages.map(page => (
                <CratePageItem
                    key={page.path}
                    page={page}
                    baseUrl={`https://docs.rs/${crate.name}/${crate.currentVersion}/`}
                    updateCrate={props.updateCrate} />))
            }
        </div>);
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
                "group/page flex items-center rounded-sm w-full px-1 cursor-pointer border",
                page.active
                    ? "bg-input shadow-sm"
                    : "border-transparent hover:bg-input/50",
                page.italic && "italic")}
            onClick={() => app.navigateTo(`${props.baseUrl}${page.path}`)}>
            <span className="flex-1 px-0.5 truncate font-mono font-light">
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
