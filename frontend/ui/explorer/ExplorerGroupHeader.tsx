import type { KeyboardEvent } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faAnglesDown,
    faAnglesUp,
    faArrowDown,
    faArrowUp,
    faArrowUpFromBracket,
    faChevronDown,
    faChevronRight,
    faCheck,
    faEllipsisVertical,
    faPencil,
    faRightToBracket,
    faTrash,
} from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";
import { Input } from "@shadcn/components/ui/input";

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
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@shadcn/components/ui/dropdown-menu";

import { useProviderData, useProviderUiState } from "@/core/context";

export default function ExplorerGroupHeader(
    props:
        | { variant: "default", groupName: string }
        | { variant: "ungrouped" }) {
    const groupName = props.variant === "default" ? props.groupName : "";
    const [providerData, updateProviderData] = useProviderData();
    const {
        expandedGroups,
        updateExpandedItems,
        updateExpandedGroups,
    } = useProviderUiState();
    const [DeleteDialog, showDeleteDialog] = useDeleteDialog();
    const [isRenaming, setIsRenaming] = useState(false);
    const [editedName, setEditedName] = useState(groupName);

    if (props.variant === "default") {
        const groupExpanded = expandedGroups.includes(groupName);
        const isFirstGroup =
            providerData.groupOrder[0] === groupName;
        const isLastGroup =
            providerData.groupOrder[providerData.groupOrder.length - 1] === groupName;

        function toggleGroupExpanded() {
            updateExpandedGroups(draft => {
                if (groupExpanded) {
                    const index = draft.indexOf(groupName);
                    if (index !== -1) draft.splice(index, 1);
                } else {
                    draft.push(groupName);
                }
            });
        }

        function expandAll() {
            const items = providerData.groups[groupName]?.items || [];
            updateExpandedItems(draft => {
                for (const itemId of items) {
                    if (!draft.includes(itemId))
                        draft.push(itemId);
                }
            });
        }

        function collapseAll() {
            const items = providerData.groups[groupName]?.items || [];
            updateExpandedItems(draft => {
                // Remove all items belonging to this group.
                for (let i = draft.length - 1; i >= 0; i--) {
                    if (items.includes(draft[i]))
                        draft.splice(i, 1);
                }
            });
        }

        function moveToTop() {
            updateProviderData(draft => {
                const filtered = draft.groupOrder.filter(name => name !== groupName);
                draft.groupOrder = [groupName, ...filtered];
            });
        }

        function moveUp() {
            updateProviderData(draft => {
                const thisIndex = draft.groupOrder.indexOf(groupName);
                const prevGroupName = draft.groupOrder[thisIndex - 1];
                if (thisIndex > 0 && prevGroupName !== undefined) {
                    draft.groupOrder[thisIndex - 1] = groupName;
                    draft.groupOrder[thisIndex] = prevGroupName;
                }
            });
        }

        function moveDown() {
            updateProviderData(draft => {
                const thisIndex = draft.groupOrder.indexOf(groupName);
                const nextGroupName = draft.groupOrder[thisIndex + 1];
                if (thisIndex >= 0 && nextGroupName !== undefined) {
                    draft.groupOrder[thisIndex + 1] = groupName;
                    draft.groupOrder[thisIndex] = nextGroupName;
                }
            });
        }

        // Move this group to immediately after the target group
        function moveUnder(targetGroupName: string) {
            updateProviderData(draft => {
                const filtered = draft.groupOrder.filter(name => name !== groupName);
                const targetIndex = filtered.indexOf(targetGroupName);
                if (targetIndex >= 0) {
                    filtered.splice(targetIndex + 1, 0, groupName);
                    draft.groupOrder = filtered;
                }
            });
        }

        function removeGroup() {
            updateProviderData(draft => {
                delete draft.groups[groupName];
            });
        }

        function confirmRename() {
            setIsRenaming(false);
            const trimmed = editedName.trim();
            if (trimmed && trimmed !== groupName) {
                const newName = trimmed;
                // Update provider data (groups + groupOrder).
                updateProviderData(draft => {
                    const group = draft.groups[groupName] || { items: [] };
                    delete draft.groups[groupName];
                    draft.groups[newName] = group;

                    const orderIndex = draft.groupOrder.indexOf(groupName);
                    if (orderIndex >= 0)
                        draft.groupOrder[orderIndex] = newName;
                });
                // Preserve expansion state under new name.
                updateExpandedGroups(draft => {
                    const index = draft.indexOf(groupName);
                    if (index >= 0)
                        draft[index] = newName;
                });
            }
        }

        function onRenameKeyDown(e: KeyboardEvent) {
            if (e.key === "Enter") {
                confirmRename();
            } else if (e.key === "Escape") {
                setIsRenaming(false);
            }
        }

        // Inline rename input mode
        if (isRenaming) {
            return (
                <div className="flex flex-row items-center h-8 py-0.5">
                    <Input
                        value={editedName}
                        onChange={e => setEditedName(e.target.value)}
                        onKeyDown={onRenameKeyDown}
                        onBlur={confirmRename}
                        autoFocus
                        className="h-7 mx-1 rounded-md font-semibold" />
                    <Button
                        variant="secondary"
                        size="icon"
                        className="size-7 rounded-md"
                        onClick={confirmRename}>
                        <FontAwesomeIcon icon={faCheck} />
                    </Button>
                </div>);
        }

        return (
            <div className="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted-foreground">
                {/* Group name */}
                <p
                    className="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate"
                    onClick={() => toggleGroupExpanded()}>
                    <FontAwesomeIcon
                        icon={groupExpanded ? faChevronDown : faChevronRight}
                        size="sm" />
                    <span className="flex-1 truncate">{groupName}</span>
                </p>
                {/* Rename button*/}
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md invisible group-hover/header:visible"
                    title="Rename group"
                    onClick={() => {
                        setIsRenaming(true);
                        setEditedName(groupName);
                    }}>
                    <FontAwesomeIcon icon={faPencil} />
                </Button>
                {/* Group Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 rounded-md">
                            <FontAwesomeIcon icon={faEllipsisVertical} />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={expandAll}>
                            <FontAwesomeIcon icon={faAnglesDown} />
                            <span>Expand All</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={collapseAll}>
                            <FontAwesomeIcon icon={faAnglesUp} />
                            <span>Collapse All</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={isFirstGroup}
                            onClick={moveToTop}>
                            <FontAwesomeIcon icon={faArrowUpFromBracket} />
                            <span>Move to Top</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={isFirstGroup}
                            onClick={moveUp}>
                            <FontAwesomeIcon icon={faArrowUp} />
                            <span>Move Up</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={isLastGroup}
                            onClick={moveDown}>
                            <FontAwesomeIcon icon={faArrowDown} />
                            <span>Move Down</span>
                        </DropdownMenuItem>
                        {/* "Move Under" submenu - only show if there are other groups */}
                        {providerData.groupOrder.length > 1 && (
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="cursor-pointer">
                                    <FontAwesomeIcon icon={faRightToBracket} />
                                    <span>Move Under</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    {providerData
                                        .groupOrder
                                        .filter(name => name in providerData.groups)
                                        .filter(name => name !== groupName)
                                        .map(targetName => (
                                            <DropdownMenuItem
                                                key={targetName}
                                                className="cursor-pointer"
                                                onClick={() => moveUnder(targetName)}>
                                                {targetName}
                                            </DropdownMenuItem>))}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>)}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={showDeleteDialog}>
                            <FontAwesomeIcon icon={faTrash} />
                            <span>Delete Group</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <DeleteDialog
                    title="Delete Group?"
                    callback={removeGroup}>
                    Are you sure you want to delete group "{props.groupName}"?
                    This action cannot be undone.
                </DeleteDialog>
            </div>);
    } else {
        return (
            <div className="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted-foreground">
                {/* Group name */}
                <p className="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate" >
                    <span className="flex-1 truncate">Ungrouped</span>
                </p>
            </div>);
    }
}

function useDeleteDialog() {
    const [open, setOpen] = useState(false);
    return [
        (props: {
            title: string,
            children: undefined | string | string[],
            callback: () => void
        }) => (
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>{props.title}</DialogTitle>
                        <DialogDescription>{props.children}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                props.callback();
                                setOpen(false);
                            }}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>),
        () => setOpen(true),
    ] as const;
}
