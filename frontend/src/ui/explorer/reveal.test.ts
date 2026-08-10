import { describe, expect, test } from "bun:test";

import {
    calculateExplorerRevealScrollTop,
    DEFAULT_EXPLORER_CENTER_RANGE,
} from "./reveal";

const BASE_GEOMETRY = {
    viewport: { top: 0, bottom: 600 },
    card: { top: 180, bottom: 360 },
    target: { top: 250, bottom: 270 },
    scrollTop: 500,
    maxScrollTop: 2_000,
};

describe("calculateExplorerRevealScrollTop", () => {
    test("uses the middle third as its default center range", () => {
        expect(DEFAULT_EXPLORER_CENTER_RANGE).toEqual({
            start: 1 / 3,
            end: 2 / 3,
        });
    });

    test("preserves position when both card and target satisfy the band", () => {
        expect(calculateExplorerRevealScrollTop(BASE_GEOMETRY)).toBe(500);
    });

    test("centers a card outside the band when its target remains compatible", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: 0, bottom: 180 },
            target: { top: 120, bottom: 140 },
        })).toBe(290);
    });

    test("constrains card centering to keep the complete target in the band", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: 450, bottom: 850 },
            target: { top: 470, bottom: 490 },
        })).toBe(770);
    });

    test("minimally moves a stable long card whose target is below the band", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: 150, bottom: 700 },
            target: { top: 650, bottom: 670 },
        })).toBe(770);
    });

    test("supports an asymmetric custom center range", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            viewport: { top: 0, bottom: 500 },
            card: { top: 350, bottom: 450 },
            target: { top: 370, bottom: 390 },
        }, { start: 0.2, end: 0.6 })).toBe(700);
    });

    test("aligns midpoints when the target is taller than the center band", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: 100, bottom: 550 },
            target: { top: 150, bottom: 500 },
        })).toBe(525);
    });

    test("clamps the result to physical scroll bounds", () => {
        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: -300, bottom: -100 },
            target: { top: -130, bottom: -110 },
            scrollTop: 50,
        })).toBe(0);

        expect(calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            card: { top: 900, bottom: 1_100 },
            target: { top: 920, bottom: 940 },
            scrollTop: 1_900,
        })).toBe(2_000);
    });

    test("rejects invalid center ranges", () => {
        expect(() => calculateExplorerRevealScrollTop(
            BASE_GEOMETRY, { start: -0.1, end: 0.5 })).toThrow(RangeError);
        expect(() => calculateExplorerRevealScrollTop(
            BASE_GEOMETRY, { start: 0.5, end: 0.5 })).toThrow(RangeError);
        expect(() => calculateExplorerRevealScrollTop(
            BASE_GEOMETRY, { start: 0.5, end: 1.1 })).toThrow(RangeError);
        expect(() => calculateExplorerRevealScrollTop(
            BASE_GEOMETRY, { start: Number.NaN, end: 0.5 })).toThrow(RangeError);
    });

    test("rejects a zero-height viewport", () => {
        expect(() => calculateExplorerRevealScrollTop({
            ...BASE_GEOMETRY,
            viewport: { top: 100, bottom: 100 },
        })).toThrow(RangeError);
    });
});
