import type { ReadonlyDeep } from 'type-fest';
import type { ReactNode } from 'react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Card } from '@/components/ui/card';
import {cn} from "@/lib/utils.ts";
import { ExternalLink, Home, Pin, PinOff } from 'lucide-react';

import type { ItemCrate } from '@/data';
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
                    <CratePageList crate={crate} updateCrate={props.updateItem} />
                </CollapsibleContent>
            </Collapsible>
        </Card>);
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

/**
 * Displays the list of documentation pages for a crate.
 *
 * Shows:
 * 1. Home link (always first, navigates to crate root)
 * 2. Pinned pages (with unpin icon)
 * 3. Preview page (italic, with pin icon) if currentPage is not pinned
 */
export function CratePageList(props: {
    crate: ReadonlyDeep<ItemCrate>;
    updateCrate(updater: (crate: ItemCrate) => void): void;
}) {
    const app = useAppContext();
    const crate = props.crate;

    const isPinned = (path: string) => crate.pinnedPages.includes(path);

    /** Whether currentPage is a preview page (not pinned and not null). */
    const hasPreview =
        crate.currentPage !== null && !isPinned(crate.currentPage);

    function handleNavigate(path: string | null) {
        const url = path
            ? `https://docs.rs/${crate.name}/${crate.currentVersion}/${path}`
            : `https://docs.rs/${crate.name}/${crate.currentVersion}/`;
        props.updateCrate(c => { c.currentPage = path; });
        app.navigateTo(url);
    }

    function handlePin(path: string) {
        props.updateCrate(c => {
            if (!c.pinnedPages.includes(path))
                c.pinnedPages.push(path);
        });
    }

    function handleUnpin(path: string) {
        props.updateCrate(c => {
            c.pinnedPages = c.pinnedPages.filter(p => p !== path);
        });
    }

    return (
        <div className='ml-2 mt-2 flex flex-col gap-1'>
            {/* Home link - always present */}
            <div
                className={cn(
                    'flex items-center gap-2 px-2 py-0.5 rounded cursor-pointer',
                    'hover:bg-accent/50',
                    crate.currentPage === null && 'bg-accent')}
                onClick={() => handleNavigate(null)}>
                <Home className='h-3 w-3' />
                <span className='flex-1 truncate text-sm'>{crate.name}</span>
            </div>

            {/* Pinned pages */}
            {crate.pinnedPages.map(path => (
                <CratePageItem
                    key={path}
                    label={path}
                    active={crate.currentPage === path}
                    onClick={() => handleNavigate(path)}
                    actionIcon={<PinOff className='h-3 w-3' />}
                    onAction={() => handleUnpin(path)} />
            ))}

            {/* Preview page (if currentPage is not pinned) */}
            {hasPreview && (
                <CratePageItem
                    label={crate.currentPage!}
                    active={true}
                    italic={true}
                    onClick={() => {}}
                    actionIcon={<Pin className='h-3 w-3' />}
                    onAction={() => handlePin(crate.currentPage!)} />
            )}
        </div>);
}

function CratePageItem(props: {
    label: string;
    active: boolean;
    italic?: boolean;
    onClick(): void;
    actionIcon: ReactNode;
    onAction(): void;
}) {
    return (
        <div
            className={cn(
                'flex items-center gap-2 px-2 py-0.5 rounded cursor-pointer',
                'hover:bg-accent/50',
                props.active && 'bg-accent',
                props.italic && 'italic')}
            onClick={props.onClick}>
            <span className='flex-1 truncate text-sm'>{props.label}</span>
            <span
                className='opacity-50 hover:opacity-100'
                onClick={e => {
                    e.stopPropagation();
                    props.onAction();
                }}>
                {props.actionIcon}
            </span>
        </div>
    );
}
