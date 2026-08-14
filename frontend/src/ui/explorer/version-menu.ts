import type { ItemVersions } from "@/core/data";

/** Number of recommended version choices kept at the crate menu's first level. */
export const DIRECT_VERSION_COUNT = 5;

/** Version choices arranged for the crate menu and its overflow submenu. */
export interface VersionMenuChoices {
    /** Preferred choices shown directly in the crate menu. */
    direct: string[];

    /** Remaining choices, retaining the provider's compatibility groups. */
    overflowGroups: string[][];
}

/** Partition version choices without losing an exceptional current selection.
 *
 * Recommended choices lead the direct list. If a provider supplies fewer than
 * five, its full history fills the remaining slots. The overflow preserves
 * compatibility-group order, removes duplicates, and retains current or
 * recommended aliases that do not occur in the normal history. */
export function buildVersionMenuChoices(
    versions: Pick<ItemVersions, "all" | "current" | "recommended">,
): VersionMenuChoices {
    const recommended = unique(versions.recommended);
    const all = versions.all.map(unique);
    const direct = unique([
        ...recommended,
        ...all.flat(),
        versions.current,
    ]).slice(0, DIRECT_VERSION_COUNT);

    const allValues = new Set(all.flat());
    const seen = new Set(direct);
    const overflowGroups: string[][] = [];

    // Current and recommended aliases may be absent from the provider's
    // ordinary history, notably for yanked releases and non-semver URLs.
    const exceptional = unique([...recommended, versions.current])
        .filter(version => !seen.has(version) && !allValues.has(version));
    if (exceptional.length > 0) {
        overflowGroups.push(exceptional);
        for (const version of exceptional) seen.add(version);
    }

    for (const group of all) {
        const remaining = group.filter(version => {
            if (seen.has(version)) return false;
            seen.add(version);
            return true;
        });
        if (remaining.length > 0) overflowGroups.push(remaining);
    }

    return { direct, overflowGroups };
}

/** Return the first occurrence of every version while preserving order. */
function unique(versions: readonly string[]): string[] {
    return [...new Set(versions)];
}
