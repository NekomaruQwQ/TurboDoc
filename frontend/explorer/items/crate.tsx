import type { ReadonlyDeep } from 'type-fest';

import { useState, useEffect } from 'react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ExternalLink } from 'lucide-react';

import { Card } from '@/components/ui/card';

import type { CrateCache, ItemCrate } from '@/data';
import type { ExplorerItemProps } from '@/explorer/common';
import { useAppContext } from '@/context';

/**
 * Displays a crate as a collapsible card.
 *
 * When collapsed, shows only the crate name.
 * When expanded, shows external links, version, and page list.
 */
export function CrateCard(props: ReadonlyDeep<ExplorerItemProps<ItemCrate>>) {
    const app = useAppContext();
    const crate = props.item;
    const crateCache = app.getCrateCache(crate.name);

    const homeUrl = `https://docs.rs/${crate.name}/${crate.currentVersion}/`;

    return (
        <Card className='px-2 py-1 rounded bg-accent'>
            <Collapsible
                open={props.expanded}
                onOpenChange={() => props.setExpanded(!props.expanded)}>
                <CollapsibleTrigger asChild>
                    <p className='font-mono opacity-90 cursor-pointer'>{crate.name}</p>
                </CollapsibleTrigger>
                <CollapsibleContent className='pt-2 pl-2 space-y-1'>
                    {/* Header row: links + version */}
                    <div className='flex flex-row items-center gap-2 text-sm text-muted-foreground'>
                        <span className='flex flex-1'>{crate.currentVersion}</span>
                        <span className='flex flex-2 flex-row items-center gap-4'>
                            {crateCache?.repository && (
                                <CrateLink label='Repository' url={crateCache.repository} />
                            )}
                            {crateCache?.homepage && (
                                <CrateLink label='Homepage' url={crateCache.homepage} />
                            )}
                        </span>
                    </div>
                    {/* PageList will go here */}
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

function CrateLink(props: { url: string; label: string }) {
    const app = useAppContext();
    return <span
        className='hover:text-foreground flex flex-row items-center gap-1'
        onClick={() => app.navigateTo(props.url)}>
        <ExternalLink className='h-3 w-3' />
        <span>{props.label}</span>
    </span>;
}