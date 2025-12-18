import { describe, expect, test } from 'bun:test';
import { computeVersionGroups } from './version-groups';

describe('computeVersionGroups', () => {
	test('returns empty array for empty versions', () => {
		const result = computeVersionGroups([]);
		expect(result).toEqual([]);
	});

	test('returns single version as latest', () => {
		const versions = [{ num: '1.0.0', yanked: false }];
		const result = computeVersionGroups(versions);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			label: '1.0.0 (latest)',
			version: '1.0.0',
			isLatest: true,
			isPrerelease: false,
			isYanked: false,
		});
	});

	test('groups versions by major.minor', () => {
		const versions = [
			{ num: '2.0.0', yanked: false },
			{ num: '1.5.2', yanked: false },
			{ num: '1.5.1', yanked: false },
			{ num: '1.5.0', yanked: false },
			{ num: '1.4.3', yanked: false },
			{ num: '1.0.0', yanked: false },
		];
		const result = computeVersionGroups(versions);

		expect(result).toHaveLength(4);
		expect(result[0]).toEqual({
			label: '2.0.0 (latest)',
			version: '2.0.0',
			isLatest: true,
			isPrerelease: false,
			isYanked: false,
		});
		expect(result[1]).toMatchObject({
			version: '1.5.2',
			isLatest: false,
		});
		expect(result[2]).toMatchObject({
			version: '1.4.3',
			isLatest: false,
		});
		expect(result[3]).toMatchObject({
			version: '1.0.0',
			isLatest: false,
		});
	});

	test('respects maxGroups parameter', () => {
		const versions = [
			{ num: '5.0.0', yanked: false },
			{ num: '4.0.0', yanked: false },
			{ num: '3.0.0', yanked: false },
			{ num: '2.0.0', yanked: false },
			{ num: '1.0.0', yanked: false },
		];
		const result = computeVersionGroups(versions, 3);

		expect(result).toHaveLength(3);
		expect(result[0].version).toBe('5.0.0');
		expect(result[1].version).toBe('4.0.0');
		expect(result[2].version).toBe('3.0.0');
	});

	test('handles pre-release versions', () => {
		const versions = [
			{ num: '1.0.0-rc.1', yanked: false },
			{ num: '1.0.0-beta.2', yanked: false },
			{ num: '0.9.0', yanked: false },
		];
		const result = computeVersionGroups(versions);

		expect(result[0]).toMatchObject({
			version: '1.0.0-rc.1',
			isLatest: true,
			isPrerelease: true,
		});
		expect(result[1]).toMatchObject({
			version: '0.9.0',
			isLatest: false,
			isPrerelease: false,
		});
	});

	test('handles yanked versions', () => {
		const versions = [
			{ num: '2.0.0', yanked: true },
			{ num: '1.0.0', yanked: false },
		];
		const result = computeVersionGroups(versions);

		expect(result[0]).toMatchObject({
			version: '2.0.0',
			isYanked: true,
		});
		expect(result[1]).toMatchObject({
			version: '1.0.0',
			isYanked: false,
		});
	});

	test('sorts versions correctly (semver order)', () => {
		const versions = [
			{ num: '1.0.0', yanked: false },
			{ num: '2.0.0', yanked: false },
			{ num: '1.5.0', yanked: false },
			{ num: '1.10.0', yanked: false },
		];
		const result = computeVersionGroups(versions);

		// Should be: 2.0.0 (latest), 1.10.0, 1.5.0, 1.0.0
		expect(result[0].version).toBe('2.0.0');
		expect(result[1].version).toBe('1.10.0');
		expect(result[2].version).toBe('1.5.0');
		expect(result[3].version).toBe('1.0.0');
	});

	test('ignores invalid semver versions', () => {
		const versions = [
			{ num: '2.0.0', yanked: false },
			{ num: 'not-a-version', yanked: false },
			{ num: '1.0.0', yanked: false },
		];
		const result = computeVersionGroups(versions);

		// Should only include valid semver
		expect(result).toHaveLength(2);
		expect(result[0].version).toBe('2.0.0');
		expect(result[1].version).toBe('1.0.0');
	});

	test('handles complex pre-release labels', () => {
		const versions = [
			{ num: '1.0.0-alpha.1', yanked: false },
			{ num: '1.0.0-beta.3', yanked: false },
			{ num: '1.0.0-rc.2', yanked: false },
		];
		const result = computeVersionGroups(versions, 5);

		expect(result).toHaveLength(1); // All are 1.0.0 major.minor
		expect(result[0]).toMatchObject({
			version: '1.0.0-rc.2', // rc comes after beta
			isPrerelease: true,
		});
	});

	test('real-world example: tokio versions', () => {
		const versions = [
			{ num: '1.42.0', yanked: false },
			{ num: '1.41.1', yanked: false },
			{ num: '1.41.0', yanked: false },
			{ num: '1.40.0', yanked: false },
			{ num: '1.0.0', yanked: false },
			{ num: '0.3.7', yanked: false },
			{ num: '0.2.25', yanked: false },
		];
		const result = computeVersionGroups(versions, 5);

		expect(result[0]).toMatchObject({
			label: '1.42.0 (latest)',
			version: '1.42.0',
			isLatest: true,
		});
		// Should group by major.minor: 1.42, 1.41, 1.40, 1.0, 0.3
		expect(result).toHaveLength(5);
		expect(result[1].version).toBe('1.41.1');
		expect(result[2].version).toBe('1.40.0');
		expect(result[3].version).toBe('1.0.0');
		expect(result[4].version).toBe('0.3.7');
	});
});
