import type { ReadonlyDeep } from 'type-fest';

import { useState } from "react";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from "@/lib/utils.ts";
import { ExternalLink, Pin } from 'lucide-react';

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
        <div className='flex flex-col p-1 rounded bg-accent border shadow-sm'>
            <Collapsible
                open={props.expanded}
                onOpenChange={() => props.setExpanded(!props.expanded)}>
                <CollapsibleTrigger asChild className='px-1'>
                    <p className='font-mono opacity-90 cursor-pointer'>{crate.name}</p>
                </CollapsibleTrigger>
                <CollapsibleContent className='text-sm gap-y-0.5'>
                    {/* Header row: links + version */}
                    <div className='flex flex-row items-center px-1 gap-2 my-0.5 text-muted-foreground'>
                        <span className='flex flex-1'>{crate.currentVersion}</span>
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
            </Collapsible>
        </div>);
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

    const baseUrl = `https://docs.rs/${crate.name}/${crate.currentVersion}/`;
    const rootModuleName = crate.name.replaceAll('-', '_');
    const rootModulePath = `${rootModuleName}/`;

    /** Converts a docs.rs path to a Rust-style qualified name. */
    function getPageNameFromPath(path: string): string {
        // Module: ends with '/'
        if (path.endsWith('/'))
            return path.slice(0, -1).replaceAll('/', '::');

        // Module: ends with '/index.html'
        if (path.endsWith('/index.html'))
            return path.slice(0, -'/index.html'.length).replaceAll('/', '::');

        // Item: {module}/{prefix}.{name}.html
        // Examples:
        //   glam/f32/struct.Vec2.html → glam::f32::Vec2
        //   tokio/fn.spawn.html → tokio::spawn
        const match = path.match(/^(.*)\/\w+\.(\w+)\.html$/);
        if (match) {
            const [, modulePath, itemName] = match;
            return modulePath
                ? `${modulePath.replaceAll('/', '::')}::${itemName}`
                : itemName ?? '<error>';
        }

        // Fallback: convert slashes to ::, strip .html
        return path.replace(/\.html$/, '').replaceAll('/', '::');
    }

    const pages: CratePageInfo[] =
        crate.pinnedPages.map(path => ({
            name: getPageNameFromPath(path),
            path,
            active: currentPage === `${baseUrl}${path}`,
            pinned: true,
            italic: false,
        }));

    pages.push({
        name: getPageNameFromPath(rootModulePath),
        path: rootModulePath,
        active: currentPage === `${baseUrl}${rootModulePath}`,
        pinned: false,
        italic: false,
    });

    if (currentPage.startsWith(baseUrl) &&
        currentPage !== `${baseUrl}${rootModulePath}`) {
        const path =
            currentPage.substring(baseUrl.length);
        if (!crate.pinnedPages.includes(path)) {
            pages.push({
                name: getPageNameFromPath(path),
                path: path,
                active: true,
                pinned: false,
                italic: true,
            });
        }
    }

    // Sort pages alphabetically by path to ensure consistent order
    pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

    return (
        <div className='flex flex-col'>
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
    const [hovered, setHovered] = useState(false);

    const pin = () => {
        props.updateCrate(crate => crate.pinnedPages.push(props.page.path));
    };

    const unpin = () => {
        props.updateCrate(crate => {
            crate.pinnedPages = crate.pinnedPages.filter(p => p !== props.page.path);
        });
    };

    return (
        <div
            className={cn(
                'flex items-center rounded w-full px-1 py-px my-px cursor-pointer border',
                (!page.active) && 'border-transparent hover:bg-input/50',
                page.active && 'bg-input shadow-sm',
                page.italic && 'italic')}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => app.navigateTo(`${props.baseUrl}${page.path}`)}>
            <span className='flex-1 truncate font-mono font-light'>{page.name}</span>
            {
                page.italic && (
                    <span className={cn(hovered? 'visible': 'hidden')} onClick={event => {
                        pin();
                        event.stopPropagation();
                    }}>
                        <Pin className='h-3 w-3'/>
                    </span>)
            }
            {
                page.pinned && (
                    <span onClick={event => {
                        unpin();
                        event.stopPropagation();
                    }}>
                        <Pin className='h-3 w-3' fill='white'/>
                    </span>)
            }
        </div>
    );
}
