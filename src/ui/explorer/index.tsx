import type { ReadonlyDeep } from "type-fest";

import type { Item } from "@/data";
import { useAppContext } from "@/core/context";

import type ExplorerItemProps from "@/explorer/ExplorerItemProps";
import CrateCard from "@/explorer/crate/CrateCard";
import ExplorerGroupHeader from "@/explorer/ExplorerGroupHeader";
import ExplorerCreateGroupComponent from "@/explorer/ExplorerCreateGroupComponent";

export default function Explorer() {
    const app = useAppContext();
    return (
        <div className="w-full h-full px-2">
            <div
                className="flex flex-col w-full h-full gap-1 py-1 rounded overflow-y-scroll"
                style={{ scrollbarWidth: "none" }}>
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
                            app.updateWorkspace(draft => {
                                updater(draft.groups[i]!.items);
                                draft.groups[i]!.items.sort((a, b) => a.name.localeCompare(b.name));
                            });
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
        props.removeGroup();
    }

    return (
        <div className="flex flex-col gap-1">
            <ExplorerGroupHeader
                groupName={props.name}
                groupExpanded={props.expanded}
                setGroupExpanded={props.setExpanded}
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
