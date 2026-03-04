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

import { Button, Dropdown, Input, Modal } from "@heroui/react";
import { useOverlayState } from "@heroui/react";

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
    const deleteDialogState = useOverlayState();
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
                    if (items.includes(draft[i]!))
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
                        className="flex-1 h-7 mx-1 font-semibold" />
                    <Button
                        variant="secondary"
                        isIconOnly
                        className="size-7 min-w-0"
                        onPress={confirmRename}>
                        <FontAwesomeIcon icon={faCheck} />
                    </Button>
                </div>);
        }

        return (
            <div className="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted">
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
                    isIconOnly
                    className="size-7 min-w-0 invisible group-hover/header:visible"
                    aria-label="Rename group"
                    onPress={() => {
                        setIsRenaming(true);
                        setEditedName(groupName);
                    }}>
                    <FontAwesomeIcon icon={faPencil} />
                </Button>
                {/* Group Menu */}
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
                                <Dropdown.Item textValue="Expand All" onAction={expandAll}>
                                    <FontAwesomeIcon icon={faAnglesDown} />
                                    <span>Expand All</span>
                                </Dropdown.Item>
                                <Dropdown.Item textValue="Collapse All" onAction={collapseAll}>
                                    <FontAwesomeIcon icon={faAnglesUp} />
                                    <span>Collapse All</span>
                                </Dropdown.Item>
                            </Dropdown.Section>
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
                            <Dropdown.Section>
                                <Dropdown.Item
                                    textValue="Delete Group"
                                    variant="danger"
                                    onAction={deleteDialogState.open}>
                                    <FontAwesomeIcon icon={faTrash} />
                                    <span>Delete Group</span>
                                </Dropdown.Item>
                            </Dropdown.Section>
                        </Dropdown.Menu>
                    </Dropdown.Popover>
                </Dropdown>
                {/* Delete confirmation dialog */}
                <Modal state={deleteDialogState}>
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
                                        onPress={deleteDialogState.close}>Cancel</Button>
                                    <Button
                                        variant="danger"
                                        onPress={() => {
                                            removeGroup();
                                            deleteDialogState.close();
                                        }}>Delete</Button>
                                </Modal.Footer>
                            </Modal.Dialog>
                        </Modal.Container>
                    </Modal.Backdrop>
                </Modal>
            </div>);
    } else {
        return (
            <div className="group/header flex flex-row h-8 py-0.5 items-center gap-0.5 text-muted">
                {/* Group name */}
                <p className="flex flex-row flex-1 gap-2 items-center text-lg pl-1 font-semibold cursor-pointer truncate" >
                    <span className="flex-1 truncate">Ungrouped</span>
                </p>
            </div>);
    }
}
