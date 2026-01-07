import type { ReadonlyDeep } from 'type-fest';

import { ExternalLink } from 'lucide-react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

import type { ItemCrate } from '@/data';
import type { ExplorerItemProps } from '@/explorer/common';
import { useAppContext } from '@/context';
import CratePageList from '@/explorer/crate/CratePageList.tsx';
import CrateVersionSelector from '@/explorer/crate/CrateVersionSelector.tsx';

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
            <CollapsibleTrigger asChild className='px-1'>
                <p className='font-mono opacity-90 cursor-pointer'>{crate.name}</p>
            </CollapsibleTrigger>
            <CollapsibleContent className='flex flex-col text-sm gap-1'>
                {/* Header row: version + links */}
                <div className='flex flex-row items-center px-1 gap-2 text-muted-foreground'>
                    <span className='flex-1'>
                        <CrateVersionSelector
                            crate={crate}
                            crateCache={crateCache}
                            updateCrate={props.updateItem} />
                    </span>
                    <span className='flex flex-row items-center gap-4 text-xs'>
                        {crateCache?.repository && (
                            <CrateLink label='Repository' url={crateCache.repository} />
                        )}
                        {crateCache?.homepage && (
                            <CrateLink label='Homepage' url={crateCache.homepage} />
                        )}
                    </span>
                </div>
                <CratePageList crate={crate} updateCrate={props.updateItem} />
            </CollapsibleContent>
        </Collapsible>);
}

function CrateLink(props: { url: string; label: string }) {
    const app = useAppContext();
    return (
        <span
            title={props.url}
            className='hover:text-foreground flex flex-row items-center gap-1'
            onClick={() => app.navigateTo(props.url)}>
            <ExternalLink className='h-3 w-3' />
            <span>{props.label}</span>
        </span>);
}
