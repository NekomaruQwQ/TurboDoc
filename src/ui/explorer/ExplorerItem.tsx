import type { ReadonlyDeep } from "type-fest";

import { Separator } from "@shadcn/components/ui/separator";

import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@radix-ui/react-collapsible";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@shadcn/components/ui/select";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";

import type { Item, ItemVersions } from "@/core/data";
import { useProviderData } from "@/core/context";

import ExplorerItemMenu
    from "@/ui/explorer/ExplorerItemMenu";
import ExplorerPageList
    from "@/ui/explorer/ExplorerPageList";

export default function ExplorerItem({ item, itemGroupName }: ReadonlyDeep<{
    item: Item,
    itemGroupName: string,
}>) {
    const [providerData, updateProviderData] = useProviderData();

    const expanded = providerData.expandedItems.includes(item.id);

    function toggleExpanded() {
        updateProviderData(draft => {
            if (expanded) {
                const index = draft.expandedItems.indexOf(item.id);
                if (index !== -1)
                    draft.expandedItems.splice(index, 1);
                else
                    console.warn(`Item "${item.id}" not found in expandedItems`);
            } else {
                draft.expandedItems.push(item.id);
            }
        });
    }

    return (
        <Collapsible
            className="flex flex-col p-1 gap-1 rounded-md bg-accent border shadow-sm truncate"
            open={expanded}
            onOpenChange={toggleExpanded}>
            <div className="flex flex-row gap-1">
                <CollapsibleTrigger asChild className="flex-1 pl-1.5 truncate">
                    <p className="font-mono cursor-pointer">{item.name}</p>
                </CollapsibleTrigger>
                {item.versions &&
                    <ExplorerItemVersionSelector
                        all={item.versions.all}
                        current={item.versions.current}
                        recommended={item.versions.recommended}
                        setCurrentVersion={item.versions?.setCurrentVersion} />
                }
                <ExplorerItemMenu item={item} itemGroupName={itemGroupName} />
            </div>
            <CollapsibleContent className="flex flex-col">
                <Separator />
                <div className="h-1" />
                <ExplorerPageList pages={item.pages} />
            </CollapsibleContent>
        </Collapsible>);
}

function ExplorerItemVersionSelector(props: ReadonlyDeep<ItemVersions>) {
    return (
        <Select value={props.current} onValueChange={props.setCurrentVersion}>
            <SelectTrigger
                size={"xs" as any}
                className={
                    "pl-2 pr-1 py-0 w-24 h-6 rounded-sm shadow-none " +
                    "text-xs text-foreground/60 cursor-pointer "}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {props.recommended.map(
                    version => (
                        <SelectItem
                            key={version}
                            value={version}
                            className="text-sm h-7 cursor-pointer">
                            {version}
                        </SelectItem>
                    ))}
                <SelectSeparator className="m-0.5" />
                {/* Placeholder for future full version list popup */}
                <SelectItem value="..." disabled className="h-7 px-2 text-sm">
                    <FontAwesomeIcon icon={faEllipsis} className="mr-1 inline" />
                    <span>More versions</span>
                </SelectItem>
            </SelectContent>
        </Select>);
}
