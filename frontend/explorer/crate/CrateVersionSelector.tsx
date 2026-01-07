import type { ReadonlyDeep } from 'type-fest';

import { MoreHorizontal } from 'lucide-react';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

import type { ItemCrate, CrateCache } from '@/data';
import {cn} from "@/lib/utils.ts";

interface CrateVersionSelectorProps {
    crate: ReadonlyDeep<ItemCrate>;
    crateCache: ReadonlyDeep<CrateCache> | undefined;
    updateCrate: (updater: (crate: ItemCrate) => void) => void;
}

/**
 * Builds the list of versions to display in the selector.
 *
 * Order:
 * 1. "latest" (special)
 * 2. Latest version from each of the 5 most recent version groups
 * 3. Current version if not already in the list
 */
function getDisplayVersions(
    currentVersion: string,
    versionGroups: ReadonlyDeep<CrateCache['versionGroups']> | undefined,
): string[] {
    const versions = ['latest'];
    const seen = new Set(['latest']);

    // Add latest from each version group (max 5)
    for (const group of versionGroups?.slice(0, 5) ?? []) {
        if (!seen.has(group.latest)) {
            versions.push(group.latest);
            seen.add(group.latest);
        }
    }

    // Add current version if not already included
    if (!seen.has(currentVersion)) {
        versions.push(currentVersion);
    }

    return versions;
}

/**
 * Dropdown selector for crate documentation version.
 *
 * Shows "latest" plus the 5 most recent major.minor versions,
 * with a placeholder "..." item for future full version list.
 */
export default function CrateVersionSelector(props: CrateVersionSelectorProps) {
    const { crate, crateCache, updateCrate } = props;
    const versions = getDisplayVersions(crate.currentVersion, crateCache?.versionGroups);

    // Build a set of yanked versions for quick lookup
    const yankedVersions = new Set(
        crateCache?.versions.filter(v => v.yanked).map(v => v.num) ?? []);

    function handleVersionChange(version: string) {
        // Ignore clicks on the "..." placeholder
        if (version === '...') return;
        updateCrate(c => c.currentVersion = version);
    }

    return (
        <Select value={crate.currentVersion} onValueChange={handleVersionChange}>
            <SelectTrigger size={'xs' as any} className='px-2 py-0 w-24 h-6 text-xs rounded-sm shadow-none'>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {versions.map(version => (
                    <SelectItem
                        key={version}
                        value={version}
                        className={cn(
                            'text-xs h-6',
                            yankedVersions.has(version) ? 'line-through opacity-60' : '')}>
                        {version === 'latest' ? 'latest' : version}
                    </SelectItem>
                ))}
                <SelectSeparator className='m-0.5' />
                {/* Placeholder for future full version list popup */}
                <SelectItem value='...' disabled className='h-6 text-xs'>
                    <MoreHorizontal className='h-3 w-3 mr-1 inline' />
                    <span>More versions</span>
                </SelectItem>
            </SelectContent>
        </Select>);
}
