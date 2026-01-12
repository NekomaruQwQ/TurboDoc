import type { ReadonlyDeep } from "type-fest";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@shadcn/components/ui/collapsible";
import { Separator } from "@shadcn/components/ui/separator";

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

import type { ItemCrate } from "@/data";
import { buildUrl } from "@/data";
import { useAppContext } from "@/core/context";

import type ExplorerItemProps from "@/explorer/ExplorerItemProps";
import CrateMenu from "@/explorer/crate/CrateMenu";
import CratePageList from "@/explorer/crate/CratePageList";
import CrateVersionSelector from "@/explorer/crate/CrateVersionSelector";

/**
 * Displays a crate as a collapsible card.
 *
 * When collapsed, shows only the crate name.
 * When expanded, shows external links, version, and page list.
 */
export default function CrateCard(props: ReadonlyDeep<ExplorerItemProps<ItemCrate>>) {
    const app = useAppContext();
    const crate = props.item;
    const crateCache = app.getCrateCache(crate.name);
    const currentPage = app.workspace.currentPage;

    // Auto-sync version: if viewing this crate with a different version, update to match
    if (currentPage.type === "crate" &&
        currentPage.crateName === crate.name &&
        currentPage.crateVersion !== crate.currentVersion) {
        props.updateItem(crate => crate.currentVersion = currentPage.crateVersion);
    }

    return (
        <Collapsible
            className="flex flex-col p-1 gap-1 rounded-md bg-accent border shadow-sm truncate"
            open={props.expanded}
            onOpenChange={() => props.setExpanded(!props.expanded)}>
            <div className="flex flex-row gap-1">
                <CollapsibleTrigger asChild className="flex-1 pl-1.5 truncate">
                    <p className="font-mono cursor-pointer">{crate.name}</p>
                </CollapsibleTrigger>
                <CrateVersionSelector
                    crate={crate}
                    crateCache={crateCache}
                    setVersion={version => {
                        // If viewing this crate"s docs, navigate to the same page with new version
                        if (currentPage.type === "crate" &&
                            currentPage.crateName === crate.name &&
                            currentPage.crateVersion === crate.currentVersion) {
                            app.navigateTo(buildUrl({ ...currentPage, crateVersion: version }));
                        } else {
                            props.updateItem(crate => crate.currentVersion = version);
                        }
                    }}/>
                <CrateMenu crate={crate} removeItem={props.removeItem} />
            </div>
            <CollapsibleContent className="flex flex-col">
                <Separator />
                <div className="h-1" />
                <CratePageList crate={crate} updateCrate={props.updateItem} />
            </CollapsibleContent>
        </Collapsible>);
}

import type { ItemVersionSelectorProps } from "@/core/data";

function ExplorerItemVersionSelector(props: ItemVersionSelectorProps) {
    return (
        <Select value={props.current} onValueChange={props.select}>
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
