/** A vertical interval measured in viewport coordinates. */
export interface VerticalRange {
    /** Inclusive upper edge of the interval. */
    top: number,

    /** Exclusive lower edge of the interval. */
    bottom: number,
}

/** Return whether every supplied range shares a positive-height interval.
 *
 * The ranges represent an element, the Explorer viewport, and any clipping
 * ancestors between them. Touching an edge is not visible because no rendered
 * row area reaches the user. */
export function hasPositiveVerticalIntersection(
    ranges: readonly VerticalRange[],
): boolean {
    if (ranges.length === 0) return false;

    let visibleTop = Number.NEGATIVE_INFINITY;
    let visibleBottom = Number.POSITIVE_INFINITY;
    for (const range of ranges) {
        visibleTop = Math.max(visibleTop, range.top);
        visibleBottom = Math.min(visibleBottom, range.bottom);
        if (visibleBottom <= visibleTop) return false;
    }
    return true;
}

/** Return whether any vertical portion of `element` is currently painted
 * inside `viewport`.
 *
 * Measuring overflow-clipping ancestors is important for Bits UI collapsibles:
 * their descendants remain mounted during the closing animation even though
 * the content is no longer visible. An element outside `viewport`'s subtree is
 * treated as hidden. */
export function isVerticallyVisibleWithin(
    element: HTMLElement,
    viewport: HTMLElement,
): boolean {
    const ranges: VerticalRange[] = [element.getBoundingClientRect()];
    let ancestor = element.parentElement;

    while (ancestor && ancestor !== viewport) {
        const overflowY = getComputedStyle(ancestor).overflowY;
        if (overflowY === "auto" ||
            overflowY === "clip" ||
            overflowY === "hidden" ||
            overflowY === "scroll")
            ranges.push(ancestor.getBoundingClientRect());
        ancestor = ancestor.parentElement;
    }

    if (ancestor !== viewport) return false;
    ranges.push(viewport.getBoundingClientRect());
    return hasPositiveVerticalIntersection(ranges);
}
