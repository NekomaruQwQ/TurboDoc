import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowUpRightFromSquare,
    faEllipsisVertical,
    faRightToBracket,
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

import type { Item, ItemLink, ItemAction, ProviderData } from "@/core/data";
import Icon from "@/ui/common/Icon";

import { useCurrentUrl, useProviderData } from "@/core/context";

export default function ExplorerItemMenu({ item, itemGroupName }: ReadonlyDeep<{
    item: Item,
    itemGroupName: string,
}>) {
    const [providerData, updateProviderData] = useProviderData();
    const moveItemActions =
        _.keys(providerData.groups).map(
            targetGroupName => (
                getMoveItemAction(
                    item.id,
                    itemGroupName,
                    targetGroupName,
                    updateProviderData)))
    const moveItemToUngroupedAction = {
        ...getMoveItemAction(
            item.id,
            itemGroupName,
            "",
            updateProviderData),
        name: "Ungrouped",
    };
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
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer">
                        <FontAwesomeIcon icon={faRightToBracket} size="sm" />
                        <span>Move to group</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <ExplorerItemMenuAction action={moveItemToUngroupedAction} />
                        <DropdownMenuSeparator />
                        {moveItemActions.map(action => (
                            <ExplorerItemMenuAction key={action.name} action={action} />
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                {item.links && <DropdownMenuSeparator />}
                {item.links?.map(link => (
                    <ExplorerItemMenuLink key={link.url} link={link} />
                ))}
                {item.actions && <DropdownMenuSeparator />}
                {item.actions?.map(action => (
                    <ExplorerItemMenuAction key={action.name} action={action} />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>);
}

function ExplorerItemMenuLink({ link }: ReadonlyDeep<{ link: ItemLink }>) {
    const [_, setCurrentUrl] = useCurrentUrl();
    const defaultLinkIcon = {
        type: "fontawesome",
        name: faArrowUpRightFromSquare,
    } as const;
    return (
        <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setCurrentUrl(link.url)}>
            <Icon icon={link.icon ?? defaultLinkIcon} size="sm" />
            <span>{link.name}</span>
        </DropdownMenuItem>);
}

function ExplorerItemMenuAction({ action }: ReadonlyDeep<{ action: ItemAction }>) {
    return (
        <DropdownMenuItem
            variant={action.destructive ? "destructive" : undefined}
            className="cursor-pointer"
            onClick={action.invoke}>
            {action.icon && <Icon icon={action.icon} size="sm" />}
            <span>{action.name}</span>
        </DropdownMenuItem>);
}

function getMoveItemAction(
    itemId: string,
    sourceGroupName: string,
    targetGroupName: string,
    updateProviderData: (updater: (draft: ProviderData) => void) => void): ItemAction {
    return {
        name: targetGroupName,
        disabled: targetGroupName === sourceGroupName || undefined,
        invoke(): void {
            if (targetGroupName !== sourceGroupName) {
                updateProviderData(
                    getMoveItemUpdater(
                        itemId,
                        sourceGroupName,
                        targetGroupName));
            }
        },
    };
}

/** Returns an updater function that moves an item from one group to another. */
//* Note that the "ungrouped" group is represented by an empty string as the group name!!
function getMoveItemUpdater(
    itemId: string,
    sourceGroupName: string,
    targetGroupName: string): (draft: ProviderData) => void {
    return draft => {
        // Collect actions to perform after validation to avoid partial updates.
        const actions: (() => void)[] = [];

        if (sourceGroupName) {
            const sourceGroup =
                draft.groups[sourceGroupName];
            if (!sourceGroup) {
                console.warn(
                    `Unable to move item ${itemId}: ` +
                    `Source group "${sourceGroupName}" not found.`);
                return;
            }

            const itemIndex =
                sourceGroup.items.indexOf(itemId);
            if (itemIndex < 0) {
                console.warn(
                    `Unable to move item ${itemId}: ` +
                    `Item not found in source group "${sourceGroupName}".`);
                return;
            }

            actions.push(() => {
                sourceGroup.items.splice(itemIndex, 1);
            });
        }

        if (targetGroupName) {
            const targetGroup =
                draft.groups[targetGroupName];

            if (!targetGroup) {
                console.warn(
                    `Unable to move item ${itemId}: ` +
                    `Target group "${targetGroupName}" not found.`);
                return;
            }

            actions.push(() => {
                targetGroup.items.push(itemId);
                targetGroup.items.sort();
            });
        }

        for (const action of actions) {
            action();
        }
    };
}
