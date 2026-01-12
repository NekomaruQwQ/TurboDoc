import type { ReadonlyDeep } from "type-fest";

import type { IconProp } from "@fortawesome/fontawesome-svg-core";
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
import { useAppContext } from "@/core/context";

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

function CrateMenuItem(props: {
    text: string;
    icon?: IconProp;
    variant?: "default" | "destructive";
    action: () => void;
}) {
    return (
        <DropdownMenuItem
            title={props.text}
            variant={props.variant}
            className="cursor-pointer"
            onClick={props.action}>
            {props.icon && <FontAwesomeIcon icon={props.icon} size="sm" />}
            <span>{props.text}</span>
        </DropdownMenuItem>);
}

function CrateMenuLink({ text, url }: { text: string, url: string | null }) {
    const app = useAppContext();
    return url && (
        <CrateMenuItem
            text={text}
            icon={faArrowUpRightFromSquare}
            action={() => app.navigateTo(url)} />);
}
