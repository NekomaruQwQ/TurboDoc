import { useState, useEffect } from "react";
import type { ReadonlyDeep } from "type-fest";

import {
    Separator,
    Select,
    ListBox,
} from "@heroui/react";

import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@radix-ui/react-collapsible";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";

import type { Item, ItemVersions } from "@/core/data";
import { useProvider } from "@/core/context";
import { useItemExpanded } from "@/core/uiState";

import ExplorerItemMenu
    from "@/ui/explorer/ExplorerItemMenu";
import ExplorerPageList
    from "@/ui/explorer/ExplorerPageList";

export default function ExplorerItem({ item, itemGroupName }: ReadonlyDeep<{
    item: Item,
    itemGroupName: string,
}>) {
    const [expanded, setExpanded] = useItemExpanded(useProvider().id, item.id);
    // Defer mounting of heavy HeroUI components (Select, Dropdown) until after
    // the first paint so the expansion animation isn't blocked by their mount cost.
    const deferred = useDeferredMount();

    function toggleExpanded() {
        setExpanded(!expanded);
    }

    return (
        <Collapsible
            className="flex flex-col p-1 rounded-3xl bg-surface border shadow-sm truncate"
            open={expanded}
            onOpenChange={toggleExpanded}>
            <div className="flex flex-row gap-1">
                <CollapsibleTrigger asChild className="flex-1 pl-1.5 truncate">
                    <p className="font-mono cursor-pointer">{item.name}</p>
                </CollapsibleTrigger>
                {deferred && item.versions &&
                    <ExplorerItemVersionSelector
                        all={item.versions.all}
                        current={item.versions.current}
                        recommended={item.versions.recommended}
                        setCurrentVersion={item.versions?.setCurrentVersion} />
                }
                {deferred && <ExplorerItemMenu item={item} itemGroupName={itemGroupName} />}
            </div>
            <CollapsibleContent className="collapsible-content flex flex-col">
                <Separator className="my-1"/>
                <ExplorerPageList pages={item.pages} />
            </CollapsibleContent>
        </Collapsible>);
}

/** Returns `false` on first render, `true` after the browser paints.
 * Lets the initial frame commit without waiting for expensive children to mount. */
function useDeferredMount(): boolean {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    return mounted;
}

function ExplorerItemVersionSelector(props: ReadonlyDeep<ItemVersions>) {
    return (
        <Select
            aria-label="Version"
            selectedKey={props.current}
            onSelectionChange={key => props.setCurrentVersion(key as string)}
            className="w-24">
            <Select.Trigger className="h-6 px-2 min-h-0 border bg-transparent shadow-none text-xs text-foreground/60 cursor-pointer">
                <Select.Value />
                <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
                <ListBox>
                    <ListBox.Section>
                        {props.recommended.map(
                            version => (
                                <ListBox.Item
                                    key={version}
                                    id={version}
                                    textValue={version}
                                    className="text-sm h-7 cursor-pointer">
                                    {version}
                                </ListBox.Item>))}
                    </ListBox.Section>
                    <ListBox.Section>
                        {/* Placeholder for future full version list popup */}
                        <ListBox.Item id="..." isDisabled textValue="..." className="h-6 px-2 text-sm">
                            <FontAwesomeIcon icon={faEllipsis} />
                        </ListBox.Item>
                    </ListBox.Section>
                </ListBox>
            </Select.Popover>
        </Select>);
}
