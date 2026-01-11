import type { KeyboardEvent } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faAnglesDown,
    faAnglesUp,
    faArrowDown,
    faArrowUp,
    faChevronDown,
    faChevronRight,
    faCheck,
    faEllipsisVertical,
    faFileImport,
    faPencil,
    faTrash,
} from "@fortawesome/free-solid-svg-icons";

import { parseUrl, type Item } from "@/data";

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
    DropdownMenuTrigger,
} from "@shadcn/components/ui/dropdown-menu";

interface ExplorerGroupHeaderProps {
    /** Name of the group. */
    groupName: string;

    /** Whether the group is expanded. */
    groupExpanded: boolean;

    /** Sets the expanded state of the group. */
    setGroupExpanded(expanded: boolean): void;

    /** Whether the group is frozen (cannot be renamed, moved and deleted). */
    isFrozen?: boolean;

    /** Whether this is the first group (disables "Move up"). */
    isFirst: boolean;

    /** Whether this is the last group (disables "Move down"). */
    isLast: boolean;

    /** Renames the group to the new name. */
    renameGroup(newName: string): void;

    /** Removes the group from the workspace. Should move items to ungrouped and remove the group. */
    removeGroup(): void;

    /** Expand all items in the group. */
    expandAll(): void;

    /** Collapse all items in the group. */
    collapseAll(): void;

    /** Move the group up in the list. */
    moveUp(): void;

    /** Move the group down in the list. */
    moveDown(): void;

    /** Import items parsed from URLs. Called with the items to add. */
    importItems(items: Item[]): void;
}


/**
 * Header for a named group with rename, expand/collapse all, and group menu.
 * Manages its own rename state (inline input).
 */
export default function ExplorerGroupHeader(props: ExplorerGroupHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [editedName, setEditedName] = useState(props.groupName);
    const [showRemoveDialog, setShowRemoveDialog] = useState(false);
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [importText, setImportText] = useState("");

    function beginRename() {
        setEditedName(props.groupName);
        setIsRenaming(true);
    }

    function confirmRename() {
        const trimmed = editedName.trim();
        if (trimmed && trimmed !== props.groupName) {
            props.renameGroup(trimmed);
        }
        setIsRenaming(false);
    }

    function cancelRename() {
        setEditedName(props.groupName);
        setIsRenaming(false);
    }

    function onRenameKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            confirmRename();
        } else if (e.key === "Escape") {
            cancelRename();
        }
    }

    function confirmRemoveGroup() {
        props.removeGroup();
        setShowRemoveDialog(false);
    }

    /** Parses URLs from textarea, groups by crate, and imports items. */
    function handleImport() {
        const lines = importText.split("\n").map(line => line.trim()).filter(Boolean);

        // Parse URLs and group by crate name
        const cratePages = new Map<string, string[]>();
        for (const line of lines) {
            const page = parseUrl(line);
            if (page.type !== "crate") continue;

            const paths = cratePages.get(page.crateName) ?? [];
            const pathStr = page.pathSegments.join("/");
            if (pathStr && !paths.includes(pathStr)) {
                paths.push(pathStr);
            }
            cratePages.set(page.crateName, paths);
        }

        // Create Item objects and import
        const items: Item[] = [];
        for (const [crateName, pinnedPages] of cratePages) {
            items.push({
                type: "crate",
                name: crateName,
                currentVersion: "latest",
                pinnedPages,
                expanded: true,
            });
        }

        if (items.length > 0) {
            props.importItems(items);
        }

        setImportText("");
        setShowImportDialog(false);
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
                onClick={() => props.setGroupExpanded(!props.groupExpanded)} >
                <FontAwesomeIcon
                    icon={props.groupExpanded ? faChevronDown : faChevronRight}
                    size="sm" />
                <span className="flex-1 truncate">{props.groupName}</span>
            </p>
            {/* Rename button*/}
            {!props.isFrozen && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md invisible group-hover/header:visible"
                    title="Rename group"
                    onClick={beginRename}>
                    <FontAwesomeIcon icon={faPencil} />
                </Button>)
            }
            {/* Group Menu */}
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md">
                        <FontAwesomeIcon icon={faEllipsisVertical} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={props.expandAll}>
                        <FontAwesomeIcon icon={faAnglesDown} />
                        <span>Expand all</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={props.collapseAll}>
                        <FontAwesomeIcon icon={faAnglesUp} />
                        <span>Collapse all</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowImportDialog(true)}>
                        <FontAwesomeIcon icon={faFileImport} />
                        <span>Import</span>
                    </DropdownMenuItem>
                    {!props.isFrozen && <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={props.isFirst}
                            onClick={props.moveUp}>
                            <FontAwesomeIcon icon={faArrowUp} />
                            <span>Move up</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={props.isLast}
                            onClick={props.moveDown}>
                            <FontAwesomeIcon icon={faArrowDown} />
                            <span>Move down</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setShowRemoveDialog(true)}>
                            <FontAwesomeIcon icon={faTrash} />
                            <span>Remove group</span>
                        </DropdownMenuItem>
                    </>}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Delete Confirmation Dialog */}
            <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Delete group?</DialogTitle>
                        <DialogDescription>
                            This will remove the group "{props.groupName}".
                            Crates in this group will be moved to Ungrouped.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowRemoveDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmRemoveGroup}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Import Dialog */}
            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import from URLs</DialogTitle>
                        <DialogDescription>
                            Paste docs.rs URLs (one per line) to add crates and pages.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        placeholder="https://docs.rs/tokio/latest/tokio/..."
                        rows={8}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
                        <Button onClick={handleImport}>Import</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>);
}
