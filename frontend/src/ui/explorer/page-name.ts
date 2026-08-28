import type { PageName } from "@/core/explorer";

/** Symbol names retain canonical identifiers even when abbreviated or aliased. */
type SymbolPageName = Extract<PageName, { type: "symbol" }>;

/** Select visible identifiers without changing full-name metadata.
 * An alias supplies its own label and identifier type, even for an empty path;
 * otherwise an empty path stays empty and full display reuses the original path. */
export function getDisplayedSymbolPath(name: SymbolPageName): SymbolPageName["path"] {
    if (typeof name.display === "object") return [name.display];
    if (name.display === "leaf") return name.path.slice(-1);
    return name.path;
}

/** Keep tooltips and accessible labels complete regardless of visual display.
 * Text labels pass through unchanged and an empty symbol path yields "". */
export function getFullPageName(name: PageName): string {
    if (name.type === "text") return name.text;
    return name.path.map(segment => segment.name).join(name.separator);
}
