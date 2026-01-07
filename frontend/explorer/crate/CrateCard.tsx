import type { ReadonlyDeep } from 'type-fest';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

import type { ItemCrate } from '@/data';
import type { ExplorerItemProps } from '@/explorer/common';
import { useAppContext } from '@/context';

import CrateMenu from '@/explorer/crate/CrateMenu';
import CratePageList from '@/explorer/crate/CratePageList';
import CrateVersionSelector from '@/explorer/crate/CrateVersionSelector';
import {Separator} from "@/components/ui/separator.tsx";

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

    if (currentPage.startsWith(`https://docs.rs/${crate.name}/`) &&
        !currentPage.startsWith(`https://docs.rs/${crate.name}/${crate.currentVersion}/`)) {
        if (currentPage.startsWith(`https://docs.rs/${crate.name}/latest/`)) {
            props.updateItem(crate => crate.currentVersion = 'latest');
        }
        for (const version of crateCache?.versions ?? []) {
            if (currentPage.startsWith(`https://docs.rs/${crate.name}/${version.num}/`)) {
                // Update the crate's current version to match the current page
                props.updateItem(crate => crate.currentVersion = version.num);
                break;
            }
        }
    }

    return (
        <Collapsible
            className='flex flex-col p-1 gap-1 rounded bg-accent border shadow-sm truncate'
            open={props.expanded}
            onOpenChange={() => props.setExpanded(!props.expanded)}>
            <div className='flex flex-row items-stretch gap-1'>
                <CollapsibleTrigger asChild className='flex-1 px-1'>
                    <p className='font-mono opacity-90 cursor-pointer'>{crate.name}</p>
                </CollapsibleTrigger>
                <CrateVersionSelector
                    crate={crate}
                    crateCache={crateCache}
                    setVersion={version => {
                        if (currentPage.startsWith(`https://docs.rs/${crate.name}/${crate.currentVersion}/`)) {
                            app.navigateTo(
                                currentPage.replace(
                                    `https://docs.rs/${crate.name}/${crate.currentVersion}/`,
                                    `https://docs.rs/${crate.name}/${version}/`));
                        } else {
                            props.updateItem(crate => crate.currentVersion = version);
                        }
                    }}/>
                <CrateMenu crate={crate} removeItem={props.removeItem} />
            </div>
            <CollapsibleContent className='flex flex-col text-sm'>
                <Separator />
                <CratePageList crate={crate} updateCrate={props.updateItem} />
            </CollapsibleContent>
        </Collapsible>);
}
