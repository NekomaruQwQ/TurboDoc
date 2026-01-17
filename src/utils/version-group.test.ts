/** biome-ignore-all lint/style/noNonNullAssertion: test code */

import { describe, expect, test } from "bun:test";

import { computeVersionGroups } from "./version-group";

describe("computeVersionGroups", () => {
	test("returns empty array for empty versions", () => {
		const result = computeVersionGroups([]);
		expect(result).toEqual([]);
	});

	test("returns single group for single version", () => {
		const versions = [{ num: "1.0.0", yanked: false }];
		const result = computeVersionGroups(versions);

		expect(result).toHaveLength(1);
		expect(result[0]!.latest).toBe("1.0.0");
		expect(result[0]!.versions).toEqual([{ num: "1.0.0", yanked: false }]);
	});

	test("groups versions by major.minor", () => {
		const versions = [
			{ num: "2.0.0", yanked: false },
			{ num: "1.5.2", yanked: false },
			{ num: "1.5.1", yanked: false },
			{ num: "1.5.0", yanked: false },
			{ num: "1.4.3", yanked: false },
			{ num: "1.0.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		// Should have 4 groups: 2.0, 1.5, 1.4, 1.0
		expect(result).toHaveLength(4);

		// Group 1: 2.0.x (latest: 2.0.0)
		expect(result[0]!.latest).toBe("2.0.0");
		expect(result[0]!.versions).toEqual([{ num: "2.0.0", yanked: false }]);

		// Group 2: 1.5.x (latest: 1.5.2, contains 1.5.2, 1.5.1, 1.5.0)
		expect(result[1]!.latest).toBe("1.5.2");
		expect(result[1]!.versions).toHaveLength(3);
		expect(result[1]!.versions[0]!.num).toBe("1.5.2");

		// Group 3: 1.4.x (latest: 1.4.3)
		expect(result[2]!.latest).toBe("1.4.3");

		// Group 4: 1.0.x (latest: 1.0.0)
		expect(result[3]!.latest).toBe("1.0.0");
	});

	test("respects maxGroups parameter", () => {
		const versions = [
			{ num: "5.0.0", yanked: false },
			{ num: "4.0.0", yanked: false },
			{ num: "3.0.0", yanked: false },
			{ num: "2.0.0", yanked: false },
			{ num: "1.0.0", yanked: false },
		];
		const result = computeVersionGroups(versions, 3);

		expect(result).toHaveLength(3);
		expect(result[0]!.latest).toBe("5.0.0");
		expect(result[1]!.latest).toBe("4.0.0");
		expect(result[2]!.latest).toBe("3.0.0");
	});

	test("handles pre-release versions", () => {
		const versions = [
			{ num: "1.0.0-rc.1", yanked: false },
			{ num: "1.0.0-beta.2", yanked: false },
			{ num: "0.9.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		// 1.0.0-rc.1 and 1.0.0-beta.2 are in same group (1.0)
		expect(result).toHaveLength(2);
		expect(result[0]!.latest).toBe("1.0.0-rc.1");
		expect(result[0]!.versions).toHaveLength(2);
		expect(result[1]!.latest).toBe("0.9.0");
	});

	test("handles yanked versions", () => {
		const versions = [
			{ num: "2.0.0", yanked: true },
			{ num: "1.0.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		expect(result[0]!.latest).toBe("2.0.0");
		expect(result[0]!.versions[0]!.yanked).toBe(true);
		expect(result[1]!.versions[0]!.yanked).toBe(false);
	});

	test("sorts versions correctly (semver order)", () => {
		const versions = [
			{ num: "1.0.0", yanked: false },
			{ num: "2.0.0", yanked: false },
			{ num: "1.5.0", yanked: false },
			{ num: "1.10.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		// Should be: 2.0.0, 1.10.0, 1.5.0, 1.0.0
		expect(result[0]!.latest).toBe("2.0.0");
		expect(result[1]!.latest).toBe("1.10.0");
		expect(result[2]!.latest).toBe("1.5.0");
		expect(result[3]!.latest).toBe("1.0.0");
	});

	test("ignores invalid semver versions", () => {
		const versions = [
			{ num: "2.0.0", yanked: false },
			{ num: "not-a-version", yanked: false },
			{ num: "1.0.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		// Should only include valid semver
		expect(result).toHaveLength(2);
		expect(result[0]!.latest).toBe("2.0.0");
		expect(result[1]!.latest).toBe("1.0.0");
	});

	test("groups all patch versions together", () => {
		const versions = [
			{ num: "1.5.3", yanked: false },
			{ num: "1.5.2", yanked: false },
			{ num: "1.5.1", yanked: false },
			{ num: "1.5.0", yanked: false },
		];
		const result = computeVersionGroups(versions);

		// All should be in one group (1.5)
		expect(result).toHaveLength(1);
		expect(result[0]!.latest).toBe("1.5.3");
		expect(result[0]!.versions).toHaveLength(4);
	});

	test("real-world example: tokio versions", () => {
		const versions = [
			{ num: "1.42.0", yanked: false },
			{ num: "1.41.1", yanked: false },
			{ num: "1.41.0", yanked: false },
			{ num: "1.40.0", yanked: false },
			{ num: "1.0.0", yanked: false },
			{ num: "0.3.7", yanked: false },
			{ num: "0.2.25", yanked: false },
		];
		const result = computeVersionGroups(versions, 5);

		// Should group by major.minor: 1.42, 1.41, 1.40, 1.0, 0.3
		expect(result).toHaveLength(5);
		expect(result[0]!.latest).toBe("1.42.0");
		expect(result[1]!.latest).toBe("1.41.1");
		expect(result[1]!.versions).toHaveLength(2); // 1.41.1 and 1.41.0
		expect(result[2]!.latest).toBe("1.40.0");
		expect(result[3]!.latest).toBe("1.0.0");
		expect(result[4]!.latest).toBe("0.3.7");
	});
});
