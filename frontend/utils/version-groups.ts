import * as semver from 'semver';
import type { VersionGroup } from '@/data';

/**
 * Compute version groups for display (latest + unique major.minor versions).
 *
 * This function takes a list of versions and groups them by major.minor,
 * returning the latest version from each group up to maxGroups.
 *
 * @param versions - Array of version objects with num and yanked properties
 * @param maxGroups - Maximum number of version groups to return (default: 5)
 * @returns Array of VersionGroup objects sorted by semver (newest first)
 */
export function computeVersionGroups(
	versions: Array<{ num: string; yanked: boolean }>,
	maxGroups: number = 5
): VersionGroup[] {
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

	const latest = parsed[0];
	const groups: VersionGroup[] = [];

	// Always show latest
	groups.push({
		label: `${latest.num} (latest)`,
		version: latest.num,
		isLatest: true,
		isPrerelease: latest.parsed!.prerelease.length > 0,
		isYanked: latest.yanked,
	});

	// Show unique major.minor versions (exclude latest)
	const seen = new Set([`${latest.parsed!.major}.${latest.parsed!.minor}`]);

	for (const v of parsed.slice(1)) {
		const key = `${v.parsed!.major}.${v.parsed!.minor}`;
		if (!seen.has(key) && groups.length < maxGroups) {
			seen.add(key);
			groups.push({
				label: v.num,
				version: v.num,
				isLatest: false,
				isPrerelease: v.parsed!.prerelease.length > 0,
				isYanked: v.yanked,
			});
		}
	}

	return groups;
}
