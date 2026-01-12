import * as semver from "semver";
import type { CrateVersion } from "@/data";

/**
 * Compute version groups for display based on semver compatibility.
 *
 * Groups versions by major.minor (semver-compatible versions) and returns
 * the latest version from each group along with all versions in that group.
 *
 * @param versions - Array of version objects with num and yanked properties (sorted newest first)
 * @param maxGroups - Maximum number of version groups to return (default: 5)
 * @returns Array of version groups, each containing the latest version and all versions in that group
 */
export function computeVersionGroups(
	versions: CrateVersion[],
	maxGroups: number = 5
): { latest: string; versions: CrateVersion[] }[] {
	const parsed = versions
		.map(v => ({
			...v,
			parsed: semver.parse(v.num)
		}))
		.filter(v => v.parsed !== null);

	// Sort by semver (newest first)
	parsed.sort((a, b) => semver.rcompare(a.parsed!, b.parsed!));

	if (parsed.length === 0) {
		return [];
	}

	// Group by major.minor
	const groupMap = new Map<string, CrateVersion[]>();

	for (const v of parsed) {
		const key = `${v.parsed!.major}.${v.parsed!.minor}`;
		if (!groupMap.has(key)) {
			groupMap.set(key, []);
		}
		groupMap.get(key)!.push({ num: v.num, yanked: v.yanked });
	}

	// Convert to array and take only maxGroups
	const groups: { latest: string; versions: CrateVersion[] }[] = [];

	for (const [_, versions] of Array.from(groupMap.entries())) {
		if (groups.length >= maxGroups) break;
		if (versions.length === 0) continue;

		// Latest version is the first one (already sorted newest first)
		groups.push({
			latest: versions[0]!.num,
			versions: versions,
		});
	}

	return groups;
}
