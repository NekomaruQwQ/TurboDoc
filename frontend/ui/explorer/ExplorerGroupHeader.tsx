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

import type { State } from "@/core/prelude";
import { useProvider, useProviderData } from "@/core/context";
import { expandItems, collapseItems, removeGroup, renameGroup } from "@/core/uiState";

// --- Main component ---

export default function ExplorerGroupHeader(
    props: { expandedState: State<boolean> } & (
        | { variant: "default", groupName: string }
        | { variant: "ungrouped" })) {
    return props.variant !== "ungrouped" ?
        <ExplorerGroupHeaderCore
            groupName={props.groupName}
            expandedState={props.expandedState}/>:
        <ExplorerGroupHeaderContainer>
            <ExplorerGroupNameLabel name="Ungrouped" />
        </ExplorerGroupHeaderContainer>;
}

function ExplorerGroupHeaderCore(props: {
    groupName: string,
    expandedState: State<boolean>,
}) {
    const [expanded, setExpanded] = props.expandedState;
    const { groupName } = props;
    const providerId = useProvider().id;
    const [, updateProviderData] = useProviderData();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);

    function confirmRename(newName: string) {
        setIsRenaming(false);
        if (newName && newName !== groupName) {
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
            renameGroup(providerId, groupName, newName);
        }
    }

    function deleteGroup() {
        updateProviderData(draft => {
            delete draft.groups[groupName];
            draft.groupOrder = draft.groupOrder.filter(name => name !== groupName);
        });
        removeGroup(providerId, groupName);
    }

    if (isRenaming) {
        return <GroupRenameInput
            groupName={groupName}
            onConfirm={confirmRename}
            onCancel={() => setIsRenaming(false)} />;
    }

    return (
        <ExplorerGroupHeaderContainer>
            <ExplorerGroupNameLabel
                name={groupName}
                icon={expanded ? faChevronDown : faChevronRight}
                onClick={() => setExpanded(!expanded)} />
            {/* Rename button */}
            <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-md invisible group-hover/header:visible"
                aria-label="Rename group"
                onClick={() => setIsRenaming(true)}>
                <FontAwesomeIcon icon={faPencil} />
            </Button>
            <ExplorerGroupMenu groupName={groupName} onDelete={() => setDeleteOpen(true)} />
            <ExplorerGroupDeletionDialog
                groupName={groupName}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                onConfirm={deleteGroup} />
        </ExplorerGroupHeaderContainer>);
}

// --- Sub-components ---

/** Shared outer shell for both default and ungrouped group headers. */
function ExplorerGroupHeaderContainer(props: { children: React.ReactNode }) {
    return (
        <div className="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted-foreground">
            {props.children}
        </div>);
}

/** Group name label with optional leading icon and click handler. */
function ExplorerGroupNameLabel(props: {
    name: string,
    icon?: import("@fortawesome/fontawesome-svg-core").IconDefinition,
    onClick?(): void,
}) {
    return (
        <p
            className="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate"
            onClick={props.onClick}>
            {props.icon && <FontAwesomeIcon icon={props.icon} size="sm" />}
            <span className="flex-1 truncate">{props.name}</span>
        </p>);
}

/** Confirmation dialog for deleting a group. */
function ExplorerGroupDeletionDialog(props: {
    groupName: string,
    open: boolean,
    onOpenChange(open: boolean): void,
    onConfirm(): void,
}) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Delete Group?</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to delete group "{props.groupName}"?
                        This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => props.onOpenChange(false)}>Cancel</Button>
                    <Button
                        variant="destructive"
                        onClick={() => {
                            props.onConfirm();
                            props.onOpenChange(false);
                        }}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>);
}

/** Dropdown menu with expand/collapse all, move operations, and delete. Reads provider state via context hooks. */
function ExplorerGroupMenu(props: {
    groupName: string,
    onDelete(): void,
}) {
    const { groupName } = props;
    const providerId = useProvider().id;
    const [providerData, updateProviderData] = useProviderData();

    const isFirstGroup = providerData.groupOrder[0] === groupName;
    const isLastGroup = providerData.groupOrder[providerData.groupOrder.length - 1] === groupName;

    function doExpandAll() {
        const items = providerData.groups[groupName]?.items || [];
        expandItems(providerId, items as string[]);
    }

    function doCollapseAll() {
        const items = providerData.groups[groupName]?.items || [];
        collapseItems(providerId, items as string[]);
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

    return (
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
                <DropdownMenuItem onClick={doExpandAll}>
                    <FontAwesomeIcon icon={faAnglesDown} />
                    <span>Expand All</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={doCollapseAll}>
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
                    onClick={props.onDelete}>
                    <FontAwesomeIcon icon={faTrash} />
                    <span>Delete Group</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>);
}

/** Inline rename input shown when the user clicks the pencil icon. */
function GroupRenameInput(props: {
    groupName: string,
    onConfirm(newName: string): void,
    onCancel(): void,
}) {
    const [editedName, setEditedName] = useState(props.groupName);

    function confirm() {
        props.onConfirm(editedName.trim());
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            confirm();
        } else if (e.key === "Escape") {
            props.onCancel();
        }
    }

    return (
        <div className="flex flex-row items-center h-8 py-0.5">
            <Input
                value={editedName}
                onChange={e => setEditedName(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={confirm}
                autoFocus
                className="flex-1 h-7 mx-1 rounded-md font-semibold" />
            <Button
                variant="secondary"
                size="icon"
                className="size-7 rounded-md"
                onClick={confirm}>
                <FontAwesomeIcon icon={faCheck} />
            </Button>
        </div>);
}
