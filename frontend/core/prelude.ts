import type { Primitive, ReadonlyDeep } from "type-fest";

// Wrapped in `[T] extends [Primitive]` to prevent distributive conditional
// types — without this, `State<boolean>` would distribute over `true | false`
// and produce `[true, (v: true) => void] | [false, (v: false) => void]`.
export type State<T> =
    [T] extends [Primitive]
        ? [T, (value: T) => void]
        : [ReadonlyDeep<T>, (updater: (draft: T) => void) => void];

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
