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
                <CollapsibleContent className='space-y-1'>
                    {/* Header row: links + version */}
                    <div className='flex flex-row items-center gap-2 mt-2 text-sm text-muted-foreground'>
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

interface CratePageInfo {
    name: string;
    path: string;
    root: string;
    active: boolean; // Is this the current page?
    pinned: boolean; // Is this page pinned?
    italic: boolean; // Is this page italicized (preview)?
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
    const currentPage = app.workspace.currentPage;

    function isPageActive(path: string): boolean {
        return currentPage === `https://docs.rs/${crate.name}/${crate.currentVersion}/${path}`;
    }

    function getModuleNameFromCrateName(crateName: string): string {
        // Simple heuristic: replace hyphens with underscores
        return crateName.replace(/-/g, '_');
    }

    const rootPath = getModuleNameFromCrateName(crate.name) + '/';

    const pages: CratePageInfo[] =
        crate.pinnedPages.map(path => ({
            name: path,
            path,
            root: rootPath,
            active: isPageActive(path),
            pinned: true,
            italic: false,
        }));

    pages.push({
        name: rootPath,
        path: rootPath,
        root: rootPath,
        active: isPageActive(rootPath),
        pinned: false,
        italic: false,
    });

    if (currentPage.startsWith(`https://docs.rs/${crate.name}/${crate.currentVersion}/`)) {
        const path =
            currentPage.substring(`https://docs.rs/${crate.name}/${crate.currentVersion}/`.length);
        if (path !== rootPath && !crate.pinnedPages.includes(path)) {
            pages.push({
                name: path,
                path: path,
                root: rootPath,
                active: true,
                pinned: false,
                italic: true,
            });
        }
    }

    // Sort pages alphabetically by path to ensure consistent order
    pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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
        <div className='flex flex-col gap-0'>
            {
                pages.map(page => (
                    <CratePageItem
                        key={page.path}
                        page={page}
                        baseUrl={`https://docs.rs/${crate.name}/${crate.currentVersion}/`}
                        updateCrate={props.updateCrate} />))
            }
        </div>);
}

function CratePageItem(props: {
    page: CratePageInfo;
    baseUrl: string;
    updateCrate(updater: (crate: ItemCrate) => void): void;
}) {
    const app = useAppContext();
    const page = props.page;
    return (
        <div
            className={cn(
                'flex items-center rounded w-full px-2 py-0.5 my-0.5 cursor-pointer border',
                (!page.active) && 'border-transparent hover:bg-input/50',
                page.active && 'bg-input shadow-sm',
                page.italic && 'italic')}
            onClick={() => app.navigateTo(`${props.baseUrl}${page.path}`)}>
            <span className='flex-1 truncate text-sm'>{page.name}</span>
            {/*<span*/}
            {/*    className='opacity-50 hover:opacity-100'*/}
            {/*    onClick={e => {*/}
            {/*        e.stopPropagation();*/}
            {/*        props.onAction();*/}
            {/*    }}>*/}
            {/*    {page.pinned && <Pin className='h-3 w-3'/>}*/}
            {/*</span>*/}
        </div>
    );
}
