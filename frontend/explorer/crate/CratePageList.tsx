import type { ReadonlyDeep } from 'type-fest';

import { useState } from "react";
import { Pin } from 'lucide-react';

import { cn } from "@/lib/utils.ts";

import type { ItemCrate } from '@/data';
import { useAppContext } from '@/context';

type SymbolType =
    | 'constant'
    | 'enum'
    | 'fn'
    | 'macro'
    | 'module'
    | 'struct'
    | 'trait'
    | 'type'
    | 'unknown';

interface CrateSymbol {
    module: string[]; // e.g., ["glam", "f32"]
    symbol: string;   // e.g., "Vec2"
    type: SymbolType; // e.g., "struct"
}

interface CratePageInfo {
    symbol: CrateSymbol;
    path: string;
    active: boolean;
    pinned: boolean;
    italic: boolean;
}

/**
 * Displays the list of documentation pages for a crate.
 *
 * Shows:
 * 1. Home link (always first, navigates to crate root)
 * 2. Pinned pages (with unpin icon)
 * 3. Preview page (italic, with pin icon) if currentPage is not pinned
 */
export default function CratePageList(props: {
    crate: ReadonlyDeep<ItemCrate>;
    updateCrate(updater: (crate: ItemCrate) => void): void;
}) {
    const crate = props.crate;
    const pages = createPageList(crate);
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

function createPageList(crate: ReadonlyDeep<ItemCrate>): CratePageInfo[] {
    const app = useAppContext();
    const currentPage = app.workspace.currentPage;

    const baseUrl = `https://docs.rs/${crate.name}/${crate.currentVersion}/`;
    const rootModuleName = crate.name.replaceAll('-', '_');
    const rootModulePath = `${rootModuleName}/`;

    const pages: CratePageInfo[] =
        crate.pinnedPages.map(path => ({
            symbol: parseSymbol(path),
            path,
            active: currentPage === `${baseUrl}${path}`,
            pinned: true,
            italic: false,
        }));

    pages.push({
        symbol: parseSymbol(rootModulePath),
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
                symbol: parseSymbol(path),
                path: path,
                active: true,
                pinned: false,
                italic: true,
            });
        }
    }

    // Sort pages alphabetically by path to ensure consistent order
    pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

    return pages;
}

function getSymbolColor(type: SymbolType): string {
    switch (type) {
        case 'struct':
        case 'enum':
        case 'type':
            return 'text-[var(--color-yellow)]';
        case 'trait':
            return 'text-[var(--color-cyan)]';
        case 'fn':
            return 'text-[var(--color-blue)]';
        case 'macro':
        case 'constant':
            return 'text-[var(--color-orange)]';
        default:
            return '';
    }
}

function parseSymbolType(prefix: string): SymbolType {
    switch (prefix) {
        case 'constant': return 'constant';
        case 'enum': return 'enum';
        case 'fn': return 'fn';
        case 'macro': return 'macro';
        case 'struct': return 'struct';
        case 'trait': return 'trait';
        case 'type': return 'type';
        default: return 'unknown';
    }
}

/** Converts a docs.rs path to a parsed path with module, symbol, and type. */
function parseSymbol(path: string): CrateSymbol {
    // Module: ends with '/'
    if (path.endsWith('/')) {
        const parts = path.slice(0, -1).split('/');
        return {
            module: parts.slice(0, -1),
            symbol: parts.at(-1) ?? '',
            type: 'module',
        };
    }

    // Module: ends with '/index.html'
    if (path.endsWith('/index.html')) {
        const parts = path.slice(0, -'/index.html'.length).split('/');
        return {
            module: parts.slice(0, -1),
            symbol: parts.at(-1) ?? '',
            type: 'module',
        };
    }

    // Item: {module}/{prefix}.{name}.html
    const match = path.match(/^(.*)\/(\w+)\.(\w+)\.html$/);
    if (match) {
        const [, modulePath, prefix, itemName] = match;
        return {
            module: modulePath?.split('/') ?? [],
            symbol: itemName ?? '',
            type: parseSymbolType(prefix ?? ''),
        };
    }

    // Fallback
    const name = path.replace(/\.html$/, '');
    const parts = name.split('/');
    return {
        module: parts.slice(0, -1),
        symbol: parts.at(-1) ?? name,
        type: 'unknown',
    };
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
            <span className='flex-1 truncate font-mono font-light'>
                {page.symbol.module.length > 0 && <span>{page.symbol.module.join('::')}::</span>}
                <span className={getSymbolColor(page.symbol.type)}>{page.symbol.symbol}</span>
            </span>
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
