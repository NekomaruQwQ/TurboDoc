import type { ReadonlyDeep } from "type-fest";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@shadcn/components/ui/collapsible";
import { Separator } from "@shadcn/components/ui/separator";

import type { ItemCrate } from "@/data";
import { buildUrl } from "@/data";
import { useAppContext } from "@/context";

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
            className="flex flex-col p-1 gap-1 rounded bg-accent border shadow-sm truncate"
            open={props.expanded}
            onOpenChange={() => props.setExpanded(!props.expanded)}>
            <div className="flex flex-row items-stretch gap-1">
                <CollapsibleTrigger asChild className="flex-1 px-1">
                    <p className="font-mono opacity-90 cursor-pointer">{crate.name}</p>
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
            <CollapsibleContent className="flex flex-col text-sm">
                <Separator />
                <CratePageList crate={crate} updateCrate={props.updateItem} />
            </CollapsibleContent>
        </Collapsible>);
}
