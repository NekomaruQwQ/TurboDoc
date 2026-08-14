/** Persisted crate fields that must survive canonical-name reconciliation. */
interface ReconcilableCrateData {
    /** Version selected for documentation navigation. */
    currentVersion: string;

    /** Relative rustdoc paths pinned under this crate. */
    pinnedPages: string[];
}

/** Produce the crates.io comparison key. Package lookup is case-insensitive,
 * and treats hyphens and underscores as equivalent even though the published
 * package retains one canonical spelling. */
function crateNameComparisonKey(name: string): string {
    return name.toLowerCase().replaceAll("-", "_");
}

/** Re-key every separator/case alias to the authoritative name reported by
 * docs.rs. Existing canonical data wins for scalar fields, while pinned pages
 * are merged so repairing an older workspace cannot discard user state.
 *
 * Returns `undefined` when the workspace contains no equivalent crate. */
export function reconcileCrateName<T extends ReconcilableCrateData>(
    crates: Record<string, T>,
    canonicalName: string): T | undefined {
    const comparisonKey = crateNameComparisonKey(canonicalName);
    const equivalents = Object.entries(crates)
        .filter(([name]) => crateNameComparisonKey(name) === comparisonKey);
    const canonical = crates[canonicalName] ?? equivalents.at(0)?.[1];
    if (!canonical) return undefined;

    const aliases = equivalents.filter(([name]) => name !== canonicalName);
    if (aliases.length === 0) return canonical;

    const pinnedPages = new Set(canonical.pinnedPages);
    for (const [name, data] of aliases) {
        for (const page of data.pinnedPages) pinnedPages.add(page);
        delete crates[name];
    }
    canonical.pinnedPages = [...pinnedPages].sort();
    crates[canonicalName] = canonical;
    return canonical;
}
