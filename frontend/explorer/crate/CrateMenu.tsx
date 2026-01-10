import type { ReadonlyDeep } from "type-fest";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowUpRightFromSquare,
    faEllipsisVertical,
    faRightToBracket,
    faRotate,
    faTrash
} from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@shadcn/components/ui/dropdown-menu";

import type { Item, ItemCrate } from "@/data";
import { useAppContext } from "@/context";

interface CrateMenuProps {
    crate: ReadonlyDeep<ItemCrate>;
    removeItem: () => void;
}

/**
 * Dropdown menu for crate actions: move to group, refresh metadata, remove.
 */
export default function CrateMenu(props: CrateMenuProps) {
    const app = useAppContext();
    const crate = props.crate;
    const crateCache = app.getCrateCache(crate.name);

    /**
     * Moves the crate to a different group.
     * @param targetGroupIndex -1 for ungrouped, 0+ for named groups
     */
    function moveCrate(targetGroupIndex: number) {
        const newItem: Item = {
            type: "crate",
            name: crate.name,
            expanded: crate.expanded,
            pinnedPages: [...crate.pinnedPages],
            currentVersion: crate.currentVersion,
        };

        app.updateWorkspace(draft => {
            if (targetGroupIndex === -1) {
                draft.ungrouped.push(newItem);
            } else {
                draft.groups[targetGroupIndex]!.items.push(newItem);
            }
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
            <DropdownMenuContent align="end">
                <DropdownMenuItem className="cursor-pointer">
                    <CrateLink label="Crates.io" url={`https://crates.io/crates/${crate.name}`} />
                </DropdownMenuItem>
                {crateCache?.repository && (
                    <DropdownMenuItem className="cursor-pointer">
                        <CrateLink label="Repository" url={crateCache.repository} />
                    </DropdownMenuItem>
                )}
                {crateCache?.homepage && (
                    <DropdownMenuItem className="cursor-pointer">
                        <CrateLink label="Homepage" url={crateCache.homepage} />
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer">
                        <FontAwesomeIcon icon={faRightToBracket} size="sm" />
                        <span>Move to group</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => moveCrate(-1)} className="cursor-pointer">
                            Ungrouped
                        </DropdownMenuItem>
                        {app.workspace.groups.map((group, index) => (
                            <DropdownMenuItem
                                key={index}
                                onClick={() => moveCrate(index)}
                                className="cursor-pointer">
                                {group.name}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={refreshMetadata} className="cursor-pointer">
                    <FontAwesomeIcon icon={faRotate} size="sm" />
                    <span>Refresh metadata</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={props.removeItem} className="cursor-pointer">
                    <FontAwesomeIcon icon={faTrash} size="sm" />
                    <span>Remove crate</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>);
}

function CrateLink(props: { url: string; label: string }) {
    const app = useAppContext();
    return (
        <span
            title={props.url}
            className="hover:text-foreground flex flex-row items-center gap-1"
            onClick={() => app.navigateTo(props.url)}>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="sm" />
            <span>{props.label}</span>
        </span>);
}
