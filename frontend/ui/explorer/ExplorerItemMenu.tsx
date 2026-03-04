import type { ReadonlyDeep } from "type-fest";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowUpRightFromSquare,
    faEllipsisVertical,
    faRightToBracket,
} from "@fortawesome/free-solid-svg-icons";

import { Button, Dropdown } from "@heroui/react";

import type { Item, ItemLink, ItemAction, ProviderData } from "@/core/data";
import Icon from "@/ui/common/Icon";

import { useCurrentUrl, useProviderData } from "@/core/context";

export default function ExplorerItemMenu({ item, itemGroupName }: ReadonlyDeep<{
    item: Item,
    itemGroupName: string,
}>) {
    const [providerData, updateProviderData] = useProviderData();
    const moveItemToUngroupedAction = {
        ...getMoveItemAction(
            item.id,
            itemGroupName,
            "",
            updateProviderData),
        name: "Ungrouped",
    };
    const moveItemActions =
        providerData
            .groupOrder
            .filter(targetGroupName => targetGroupName in providerData.groups)
            .map(targetGroupName => (
                getMoveItemAction(
                    item.id,
                    itemGroupName,
                    targetGroupName,
                    updateProviderData)))
    return (
        <Dropdown>
            <Dropdown.Trigger>
                <Button
                    variant="ghost"
                    isIconOnly
                    className="size-6 min-w-0 border hover:bg-input/50 cursor-pointer">
                    <FontAwesomeIcon icon={faEllipsisVertical} size="sm" />
                </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover>
                <Dropdown.Menu>
                    <Dropdown.SubmenuTrigger>
                        <Dropdown.Item textValue="Move to group" className="cursor-pointer">
                            <FontAwesomeIcon icon={faRightToBracket} size="sm" />
                            <span>Move to group</span>
                            <Dropdown.SubmenuIndicator />
                        </Dropdown.Item>
                        <Dropdown.Popover>
                            <Dropdown.Menu>
                                <Dropdown.Section>
                                    <ExplorerItemMenuAction action={moveItemToUngroupedAction} />
                                </Dropdown.Section>
                                <Dropdown.Section>
                                    {moveItemActions.map(action => (
                                        <ExplorerItemMenuAction key={action.name} action={action} />
                                    ))}
                                </Dropdown.Section>
                            </Dropdown.Menu>
                        </Dropdown.Popover>
                    </Dropdown.SubmenuTrigger>
                    {item.links && (
                        <Dropdown.Section>
                            {item.links?.map(link => (
                                <ExplorerItemMenuLink key={link.name} link={link} />
                            ))}
                        </Dropdown.Section>)}
                    {item.actions && (
                        <Dropdown.Section>
                            {item.actions?.map(action => (
                                <ExplorerItemMenuAction key={action.name} action={action} />
                            ))}
                        </Dropdown.Section>)}
                </Dropdown.Menu>
            </Dropdown.Popover>
        </Dropdown>);
}

function ExplorerItemMenuLink({ link }: ReadonlyDeep<{ link: ItemLink }>) {
    const [_, setCurrentUrl] = useCurrentUrl();
    const defaultLinkIcon = {
        type: "fontawesome",
        name: faArrowUpRightFromSquare,
    } as const;
    return (
        <Dropdown.Item
            textValue={link.name}
            className="cursor-pointer"
            onAction={() => setCurrentUrl(link.url)}>
            <Icon icon={link.icon ?? defaultLinkIcon} size="sm" />
            <span>{link.name}</span>
        </Dropdown.Item>);
}

function ExplorerItemMenuAction({ action }: ReadonlyDeep<{ action: ItemAction }>) {
    return (
        <Dropdown.Item
            variant={action.destructive ? "danger" : undefined}
            isDisabled={action.disabled ?? false}
            textValue={action.name}
            className="cursor-pointer"
            onAction={() => action.invoke()}>
            {action.icon && <Icon icon={action.icon} size="sm" />}
            <span>{action.name}</span>
        </Dropdown.Item>);
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
