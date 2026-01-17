import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faThumbtack } from "@fortawesome/free-solid-svg-icons";

import type { IdentType, Page, PageName } from "@/core/data";
import { cn } from "@/core/prelude";
import { useCurrentUrl } from "@/core/context";

function getIdentColor(type: IdentType): string | undefined {
    switch (type) {
        case "type":
            return "text-[var(--color-yellow)]";
        case "interface":
            return "text-[var(--color-cyan)]";
        case "function":
            return "text-[var(--color-blue)]";
        case "macro":
        case "constant":
            return "text-[var(--color-orange)]";
        case "namespace":
        case "unknown":
            return undefined;
    }
}

/**
 * Displays the list of documentation pages for a crate.
 *
 * Shows:
 * 1. Home link (always first, navigates to crate root)
 * 2. Pinned pages (with unpin icon)
 * 3. Preview page (italic, with pin icon) if currentPage is not pinned
 */
export default function ExplorerPageList({ pages }: ReadonlyDeep<{ pages: Page[] }>) {
    return (
        <div className="flex flex-col gap-0.5">
            {_.pipe(
                pages,
                _.sortBy(page => page.sortKey),
                _.map(page => <ExplorerPage key={page.url} page={page} />))
            }
        </div>);
}

function ExplorerPage({ page }: ReadonlyDeep<{ page: Page }>) {
    const [currentUrl, setCurrentUrl] = useCurrentUrl();
    const active = page.url === currentUrl;
    const pinned = page.pinned === true;
    const italic = page.pinned === false;
    return (
        <div
            className={cn(
                "group/page flex items-center rounded-sm w-full px-1 cursor-pointer border",
                active
                    ? "bg-input shadow-sm"
                    : "border-transparent hover:bg-input/50",
                italic && "italic")}
            onClick={() => setCurrentUrl(page.url)}>
            <span className="flex-1 px-0.5 truncate font-mono font-light">
                <ExplorerPageName value={page.name} />
            </span>
            <ExplorerPagePinningButton
                pinned={pinned}
                italic={italic}
                setPinned={value => {
                    if (page.pinned !== null) {
                        page.setPinned(value);
                    } else {
                        console.warn("Trying to pin/unpin a page with pinning disabled.");
                    }
                }}/>
        </div>);
}

function ExplorerPageName({ value }: ReadonlyDeep<{ value: PageName }>) {
    switch (value.type) {
        case "text":
            return <>{value.text}</>;
        case "symbol":
            // Keys omitted: path is static per render, elements are stateless inline
            // spans, so React reconciliation works correctly without explicit keys.
            return value.path.map((ident, index) => <>
                {index > 0 && <span>{value.separator}</span>}
                <span className={getIdentColor(ident.type)}>{ident.name}</span>
            </>);
    }
}

function ExplorerPagePinningButton(props: {
    pinned: boolean,
    italic: boolean,
    setPinned(pinned: boolean): void,
}) {
    return <>
        {props.pinned &&
            <span
                onClick={event => {
                    props.setPinned(false);
                    event.stopPropagation();
                }}>
                <FontAwesomeIcon
                    icon={faThumbtack}
                    size="xs" />
            </span>
        }
        {props.italic &&
            <span
                className="invisible group-hover/page:visible"
                onClick={event => {
                    props.setPinned(true);
                    event.stopPropagation();
                }}>
                <FontAwesomeIcon
                    icon={faThumbtack}
                    size="xs"
                    className="text-foreground/50"/>
            </span>
        }
    </>
}
