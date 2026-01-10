import type { ReadonlyDeep } from "type-fest";
import type { ReactElement } from "react";

import type { Item } from "@/data";
import { useAppContext } from "@/context";

import type ExplorerItemProps from "@/explorer/ExplorerItemProps";
import CrateCard from "@/explorer/crate/CrateCard";
import ExplorerGroupHeader from "@/explorer/ExplorerGroupHeader";
import ExplorerCreateGroupComponent from "@/explorer/ExplorerCreateGroupComponent";

export function Explorer() {
    const app = useAppContext();
    return (
        <div className="px-2 w-full h-full">
            <div
                className="flex flex-col gap-4 py-2 w-full h-full rounded overflow-x-hidden overflow-y-scroll"
                style={{ scrollbarWidth: "none" }}>
                <ExplorerUngrouped
                    key=":ungrouped:"
                    items={app.workspace.ungrouped}
                    updateItems={updater => app.updateWorkspace(draft => updater(draft.ungrouped))} />
                <ExplorerCreateGroupComponent insertAt="top" />
                {app.workspace.groups.map((group, i) => (
                    <ExplorerGroup
                        key={i}
                        name={group.name}
                        items={group.items}
                        expanded={group.expanded}
                        groupIndex={i}
                        groupCount={app.workspace.groups.length}
                        setName={name => {
                            app.updateWorkspace(draft => { draft.groups[i]!.name = name; });
                        }}
                        setExpanded={expanded => {
                            app.updateWorkspace(draft => { draft.groups[i]!.expanded = expanded; });
                        }}
                        updateItems={updater => {
                            app.updateWorkspace(draft => updater(draft.groups[i]!.items));
                        }}
                        moveUp={() => {
                            if (i === 0) return;
                            app.updateWorkspace(draft => {
                                const temp = draft.groups[i - 1]!;
                                draft.groups[i - 1] = draft.groups[i]!;
                                draft.groups[i] = temp;
                            });
                        }}
                        moveDown={() => {
                            if (i === app.workspace.groups.length - 1) return;
                            app.updateWorkspace(draft => {
                                const temp = draft.groups[i + 1]!;
                                draft.groups[i + 1] = draft.groups[i]!;
                                draft.groups[i] = temp;
                            });
                        }}
                        removeGroup={() => {
                            app.updateWorkspace(draft => { draft.groups.splice(i, 1); });
                        }} />
                ))}
                <ExplorerCreateGroupComponent insertAt="bottom" />
            </div>
        </div>);
}

function ExplorerUngrouped(props: ReadonlyDeep<{
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    function expandAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = true;
        });
    }

    function collapseAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = false;
        });
    }

    function unreachable() {
        throw new Error("Unreachable code executed");
    }

    return (
        <ExplorerGroupCommon
            expanded={true}
            items={props.items}
            updateItems={props.updateItems}>
            <ExplorerGroupHeader
                groupName="Ungrouped"
                isFrozen={true}
                isFirst={true}
                isLast={true}
                expandAll={expandAll}
                collapseAll={collapseAll}
                moveUp={unreachable}
                moveDown={unreachable}
                renameGroup={unreachable}
                removeGroup={unreachable}
                importItems={items => props.updateItems(draft => draft.push(...items))} />
        </ExplorerGroupCommon>);
}

function ExplorerGroup(props: ReadonlyDeep<{
    name: string;
    items: Item[];
    expanded: boolean;
    groupIndex: number;
    groupCount: number;
    setName(name: string): void;
    setExpanded(expanded: boolean): void;
    updateItems(updater: (items: Item[]) => void): void;
    moveUp(): void;
    moveDown(): void;
    removeGroup(): void;
}>) {
    const app = useAppContext();

    function expandAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = true;
        });
    }

    function collapseAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = false;
        });
    }

    function removeGroup() {
        // Move all crates to ungrouped before removing the group
        app.updateWorkspace(draft => {
            const groupItems = props.items as Item[];
            draft.ungrouped.push(...groupItems);
        });
        props.removeGroup();
    }

    return (
        <ExplorerGroupCommon
            expanded={true}
            items={props.items}
            updateItems={props.updateItems}>
            <ExplorerGroupHeader
                groupName={props.name}
                isFrozen={false}
                isFirst={props.groupIndex === 0}
                isLast={props.groupIndex === props.groupCount - 1}
                expandAll={expandAll}
                collapseAll={collapseAll}
                moveUp={props.moveUp}
                moveDown={props.moveDown}
                renameGroup={props.setName}
                removeGroup={removeGroup}
                importItems={items => props.updateItems(draft => draft.push(...items))} />
        </ExplorerGroupCommon>);
}

function ExplorerGroupCommon(props: ReadonlyDeep<{
    children: ReactElement<{}, typeof ExplorerGroupHeader>;
    expanded: boolean;
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    return (
        <div className="flex flex-col gap-1">
            {props.children}
            <div className="flex flex-col gap-2">
                {props.expanded && props.items.map((item, i) => (
                    <ExplorerItem
                        key={i}
                        item={item}
                        expanded={item.expanded}
                        setExpanded={expanded => {
                            props.updateItems(items => { items[i]!.expanded = expanded; });
                        }}
                        updateItem={updater => {
                            props.updateItems(items => updater(items[i]!));
                        }}
                        removeItem={() => {
                            props.updateItems(items => { items.splice(i, 1); });
                        }} />))}
            </div>
        </div>);
}

function ExplorerItem(props: ReadonlyDeep<ExplorerItemProps<Item>>) {
    switch (props.item.type) {
        case "crate":
            return (
                <CrateCard
                    expanded={props.expanded}
                    setExpanded={props.setExpanded}
                    item={props.item}
                    updateItem={props.updateItem}
                    removeItem={props.removeItem} />);
        default:
            return null;
    }
}
