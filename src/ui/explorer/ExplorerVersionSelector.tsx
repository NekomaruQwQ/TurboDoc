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

import type { ItemVersions } from "@/core/data";

/**
 * Dropdown component for selecting the current version of a documentation item.
 *
 * Shows "latest" plus the 5 most recent major.minor versions,
 * with a placeholder "..." item for future full version list.
 */
export default function ExplorerVersionSelector({ versions }: { versions: ItemVersions }) {
    return (
        <Select
            value={versions.current}
            onValueChange={version => {
                if (versions.all.flat().includes(version)) {
                    versions.select(version);
                } else {
                    console.warn("Trying to select a version not listed in `versionSelectorProps.all`");
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
                {versions.recommended.map(version => (
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
