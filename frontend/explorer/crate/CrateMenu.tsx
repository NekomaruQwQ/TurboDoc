import type { ReadonlyDeep } from 'type-fest';

import { MoreVertical, RefreshCw, Trash2, FolderInput, ExternalLink } from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { Item, ItemCrate } from '@/data';
import { useAppContext } from '@/context';

interface CrateMenuProps {
    crate: ReadonlyDeep<ItemCrate>;
    removeItem: () => void;
}

/**
 * Dropdown menu for crate actions: move to group, refresh metadata, remove.
 */
export default function CrateMenu(props: CrateMenuProps) {
    const app = useAppContext();
    const crate = props.crate;
    const crateCache = app.getCrateCache(crate.name);

    /**
     * Moves the crate to a different group.
     * @param targetGroupIndex -1 for ungrouped, 0+ for named groups
     */
    function moveCrate(targetGroupIndex: number) {
        const newItem: Item = {
            type: 'crate',
            data: { name: crate.name, pinnedPages: [...crate.pinnedPages], currentVersion: crate.currentVersion },
            expanded: true,
        };

        app.updateWorkspace(draft => {
            if (targetGroupIndex === -1) {
                draft.ungrouped.push(newItem);
            } else {
                draft.groups[targetGroupIndex]!.items.push(newItem);
            }
        });

        // Remove from current location after adding to new location
        props.removeItem();
    }

    function refreshMetadata() {
        app.refreshCrateCache(crate.name);
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className='p-0.5 border rounded hover:bg-background/50 text-muted-foreground hover:text-foreground'>
                    <MoreVertical className='h-4 w-4' />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
                <DropdownMenuItem>
                    <CrateLink label='Crates.io' url={`https://crates.io/crates/${crate.name}`} />
                </DropdownMenuItem>
                {crateCache?.repository && (
                    <DropdownMenuItem>
                        <CrateLink label='Repository' url={crateCache.repository} />
                    </DropdownMenuItem>
                )}
                {crateCache?.homepage && (
                    <DropdownMenuItem>
                        <CrateLink label='Homepage' url={crateCache.homepage} />
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <FolderInput className='h-3 w-3' />
                        <span>Move to group</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => moveCrate(-1)}>
                            Ungrouped
                        </DropdownMenuItem>
                        {app.workspace.groups.map((group, index) => (
                            <DropdownMenuItem
                                key={group.name}
                                onClick={() => moveCrate(index)}
                               >
                                {group.name}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={refreshMetadata}>
                    <RefreshCw className='h-3 w-3' />
                    <span>Refresh metadata</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={props.removeItem}>
                    <Trash2 className='h-3 w-3' />
                    <span>Remove crate</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>);
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
