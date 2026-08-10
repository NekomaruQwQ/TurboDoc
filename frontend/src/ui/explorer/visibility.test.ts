import { describe, expect, test } from "bun:test";

import { hasPositiveVerticalIntersection } from "./visibility";

describe("hasPositiveVerticalIntersection", () => {
    test("accepts a row fully inside the Explorer viewport", () => {
        expect(hasPositiveVerticalIntersection([
            { top: 120, bottom: 140 },
            { top: 80, bottom: 300 },
        ])).toBe(true);
    });

    test("accepts a partially visible row to avoid unnecessary movement", () => {
        expect(hasPositiveVerticalIntersection([
            { top: 70, bottom: 90 },
            { top: 80, bottom: 300 },
        ])).toBe(true);
    });

    test("rejects a row outside the Explorer viewport", () => {
        expect(hasPositiveVerticalIntersection([
            { top: 40, bottom: 60 },
            { top: 80, bottom: 300 },
        ])).toBe(false);
    });

    test("rejects a mounted row clipped by a collapsed ancestor", () => {
        expect(hasPositiveVerticalIntersection([
            { top: 120, bottom: 140 },
            { top: 110, bottom: 110 },
            { top: 80, bottom: 300 },
        ])).toBe(false);
    });

    test("does not treat edge contact as visible area", () => {
        expect(hasPositiveVerticalIntersection([
            { top: 60, bottom: 80 },
            { top: 80, bottom: 300 },
        ])).toBe(false);
    });

    test("rejects an empty measurement", () => {
        expect(hasPositiveVerticalIntersection([])).toBe(false);
    });
});
