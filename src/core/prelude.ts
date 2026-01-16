import type { Primitive, ReadonlyDeep } from "type-fest";

export type State<T> =
    T extends Primitive
        ? [T, (value: T) => void]
        : [ReadonlyDeep<T>, (updater: (draft: T) => void) => void];

/**
 * An assertion that throws an Error if the condition is not satisfied.
 * @param condition The boolean condition to check.
 * @param message The message to include in the error if the assertion fails.
 */
export function assert(condition: boolean, message?: string): asserts condition {
    if (!condition) {
        if (message) {
            throw new Error(`Assertion failed: ${message}`);
        } else {
            throw new Error("Assertion failed");
        }
    }
}

export function assertSome<T>(value: T | null | undefined, message?: string): T {
    if (value !== null && value !== undefined) {
        return value;
    } else {
        if (message) {
            throw new Error(`Assertion failed: ${message}`);
        } else {
            throw new Error("Assertion failed: unexpected null or undefined");
        }
    }
}

export const ArrayExt = {
    sortByKey<T, K>(array: readonly T[], keyFn: (item: T) => K): T[] {
        return [...array].sort((a, b) => {
            const keyA = keyFn(a);
            const keyB = keyFn(b);
            if (keyA < keyB) return -1;
            if (keyA > keyB) return 1;
            return 0;
        });
    },
} as const;

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using `clsx` and merges Tailwind CSS classes using `twMerge`.
 * @param inputs The class names to combine.
 * @returns The combined and merged class names.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
