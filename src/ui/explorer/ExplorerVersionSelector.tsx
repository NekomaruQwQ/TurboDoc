import type { ReadonlyDeep } from "type-fest";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@shadcn/components/ui/select";

import type { ItemCrate, CrateCache } from "@/data";

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
    versionGroups: ReadonlyDeep<CrateCache["versionGroups"]> | undefined,
): string[] {
    const versions = ["latest"];
    const seen = new Set(["latest"]);

    // Add latest from each version group (max 5)
    for (const group of versionGroups?.slice(0, 5) ?? []) {
        const latestInGroup = group.versions[0] ?? null;
        if (latestInGroup &&
            !seen.has(latestInGroup.num) &&
            !latestInGroup.yanked) {
            versions.push(latestInGroup.num);
            seen.add(latestInGroup.num);
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
export default function CrateVersionSelector(props: {
    crate: ReadonlyDeep<ItemCrate>;
    crateCache: ReadonlyDeep<CrateCache> | undefined;
    setVersion(version: string): void;
}) {
    const { crate, crateCache } = props;
    const versions = getDisplayVersions(crate.currentVersion, crateCache?.versionGroups);
    return (
        <Select value={crate.currentVersion} onValueChange={version => {
            if (version == "latest" || crateCache?.versions.find(({ num }) => num === version)) {
                props.setVersion(version);
            }
        }}>
            <SelectTrigger
                size={"xs" as any}
                className={
                    "pl-2 pr-1 py-0 w-24 h-6 rounded-sm shadow-none " +
                    "text-xs text-foreground/60 cursor-pointer "}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {versions.map(version => (
                    <SelectItem key={version} value={version} className="text-sm h-7 cursor-pointer">
                        {version}
                    </SelectItem>
                ))}
                <SelectSeparator className="m-0.5" />
                {/* Placeholder for future full version list popup */}
                <SelectItem value="..." disabled className="h-7 px-2 text-sm">
                    <FontAwesomeIcon icon={faEllipsis} className="mr-1 inline" />
                    <span>More versions</span>
                </SelectItem>
            </SelectContent>
        </Select>);
}
