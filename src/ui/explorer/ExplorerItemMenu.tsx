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

import type { Item, ItemLink, ItemAction } from "@/core/data";
import Icon from "@/ui/common/Icon";

import { useAppContext, useCurrentUrl, useProviderData } from "@/core/context";

/**
 * Dropdown menu for crate actions: move to group, refresh metadata, remove.
 */
export default function ExplorerItemMenu({ item, ...props }: {
    item: Item,
}) {
    const app = useAppContext();
    const [providerData, updateProviderData] = useProviderData();

    function moveItem(
        itemName: string,
        sourceGroupName: string,
        targetGroupName: string) {
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
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer">
                        <FontAwesomeIcon icon={faRightToBracket} size="sm" />
                        <span>Move to group</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        {providerData.groups.map((group, index) => (
                            <ExplorerItemMenuAction
                                action={{
                                    name: group.name,
                                    icon: {
                                        type: "fontawesome",
                                        name: faRightToBracket,
                                    },
                                    invoke: () => {
                                        moveItem(
                                            item.name,
                                            group.name,
                                            group.name);
                                    },
                                }} />
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                {item.links.map((link, index) => (
                    <ExplorerItemMenuLink key={index} link={link} />
                ))}
                <DropdownMenuSeparator />
                {item.actions.map((action, index) => (
                    <ExplorerItemMenuAction key={index} action={action} />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>);
}

function ExplorerItemMenuLink({ link }: { link: ItemLink }) {
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


function ExplorerItemMenuAction({ action }: { action: ItemAction }) {
    return (
        <DropdownMenuItem
            variant={action.destructive ? "destructive" : undefined}
            className="cursor-pointer"
            onClick={action.invoke}>
            <Icon icon={action.icon} size="sm" />
            <span>{action.name}</span>
        </DropdownMenuItem>);
}
