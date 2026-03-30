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

import { Button, Dropdown, Input, Modal, Separator } from "@heroui/react";
import { useOverlayState } from "@heroui/react";

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
    const deleteDialogState = useOverlayState();
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
                isIconOnly
                className="size-7 min-w-0 invisible group-hover/header:visible"
                aria-label="Rename group"
                onPress={() => setIsRenaming(true)}>
                <FontAwesomeIcon icon={faPencil} />
            </Button>
            <ExplorerGroupMenu groupName={groupName} onDelete={deleteDialogState.open} />
            <ExplorerGroupDeletionDialog
                groupName={groupName}
                state={deleteDialogState}
                onConfirm={deleteGroup} />
        </ExplorerGroupHeaderContainer>);
}

// --- Sub-components ---

/** Shared outer shell for both default and ungrouped group headers. */
function ExplorerGroupHeaderContainer(props: { children: React.ReactNode }) {
    return (
        <div className="group/header flex flex-row h-12 items-center gap-0.5 text-muted">
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
    state: ReturnType<typeof useOverlayState>,
    onConfirm(): void,
}) {
    return (
        <Modal state={props.state}>
            <Modal.Backdrop>
                <Modal.Container>
                    <Modal.Dialog>
                        <Modal.Header>
                            <Modal.Heading>Delete Group?</Modal.Heading>
                        </Modal.Header>
                        <Modal.Body>
                            Are you sure you want to delete group "{props.groupName}"?
                            This action cannot be undone.
                        </Modal.Body>
                        <Modal.Footer>
                            <Button
                                variant="outline"
                                onPress={props.state.close}>Cancel</Button>
                            <Button
                                variant="danger"
                                onPress={() => {
                                    props.onConfirm();
                                    props.state.close();
                                }}>Delete</Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>);
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
        <Dropdown>
            <Dropdown.Trigger>
                <Button
                    variant="ghost"
                    isIconOnly
                    className="size-7 min-w-0">
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu>
                    <Dropdown.Section>
                        <Dropdown.Item textValue="Expand All" onAction={doExpandAll}>
                            <FontAwesomeIcon icon={faAnglesDown} />
                            <span>Expand All</span>
                        </Dropdown.Item>
                        <Dropdown.Item textValue="Collapse All" onAction={doCollapseAll}>
                            <FontAwesomeIcon icon={faAnglesUp} />
                            <span>Collapse All</span>
                        </Dropdown.Item>
                    </Dropdown.Section>
                    <Separator />
                    <Dropdown.Section>
                        <Dropdown.Item
                            textValue="Move to Top"
                            isDisabled={isFirstGroup}
                            onAction={moveToTop}>
                            <FontAwesomeIcon icon={faArrowUpFromBracket} />
                            <span>Move to Top</span>
                        </Dropdown.Item>
                        <Dropdown.Item
                            textValue="Move Up"
                            isDisabled={isFirstGroup}
                            onAction={moveUp}>
                            <FontAwesomeIcon icon={faArrowUp} />
                            <span>Move Up</span>
                        </Dropdown.Item>
                        <Dropdown.Item
                            textValue="Move Down"
                            isDisabled={isLastGroup}
                            onAction={moveDown}>
                            <FontAwesomeIcon icon={faArrowDown} />
                            <span>Move Down</span>
                        </Dropdown.Item>
                        {/* "Move Under" submenu - only show if there are other groups */}
                        {providerData.groupOrder.length > 1 && (
                            <Dropdown.SubmenuTrigger>
                                <Dropdown.Item textValue="Move Under" className="cursor-pointer">
                                    <FontAwesomeIcon icon={faRightToBracket} />
                                    <span>Move Under</span>
                                    <Dropdown.SubmenuIndicator />
                                </Dropdown.Item>
                                <Dropdown.Popover>
                                    <Dropdown.Menu>
                                        {providerData
                                            .groupOrder
                                            .filter(name => name in providerData.groups)
                                            .filter(name => name !== groupName)
                                            .map(targetName => (
                                                <Dropdown.Item
                                                    key={targetName}
                                                    textValue={targetName}
                                                    className="cursor-pointer"
                                                    onAction={() => moveUnder(targetName)}>
                                                    {targetName}
                                                </Dropdown.Item>))}
                                    </Dropdown.Menu>
                                </Dropdown.Popover>
                            </Dropdown.SubmenuTrigger>)}
                    </Dropdown.Section>
                    <Separator />
                    <Dropdown.Section>
                        <Dropdown.Item
                            textValue="Delete Group"
                            className="text-danger"
                            onAction={props.onDelete}>
                            <FontAwesomeIcon icon={faTrash} />
                            <span>Delete Group</span>
                        </Dropdown.Item>
                    </Dropdown.Section>
                </Dropdown.Menu>
            </Dropdown.Popover>
        </Dropdown>);
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
                className="flex-1 h-7 mx-1 font-semibold" />
            <Button
                isIconOnly
                className="size-7 min-w-0"
                onPress={confirm}>
                <FontAwesomeIcon icon={faCheck} />
            </Button>
        </div>);
}
