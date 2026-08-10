/** A vertical interval measured in viewport coordinates. */
export interface VerticalRange {
    /** Inclusive upper edge of the interval. */
    top: number,

    /** Exclusive lower edge of the interval. */
    bottom: number,
}

/** Fractional vertical band used to stabilize Explorer navigation reveals. */
export interface ExplorerCenterRange {
    /** Upper band edge as a fraction of viewport height. */
    start: number,

    /** Lower band edge as a fraction of viewport height. */
    end: number,
}

/** Default middle-third band for Explorer navigation reveals. */
export const DEFAULT_EXPLORER_CENTER_RANGE: Readonly<ExplorerCenterRange> = {
    start: 1 / 3,
    end: 2 / 3,
};

/** Geometry needed to derive one final Explorer scroll position. */
export interface ExplorerRevealGeometry {
    /** Current Explorer viewport bounds. */
    viewport: VerticalRange,

    /** Complete expanded crate-card bounds. */
    card: VerticalRange,

    /** Selected page-row bounds, or crate-header bounds as a fallback. */
    target: VerticalRange,

    /** Current scroll offset of the Explorer viewport. */
    scrollTop: number,

    /** Greatest physically reachable Explorer scroll offset. */
    maxScrollTop: number,
}

/** Clamp `value` to the inclusive interval from `minimum` through `maximum`. */
function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

/** Validate a developer-supplied fractional center range.
 *
 * @throws {RangeError} When either edge is non-finite or the range does not
 * satisfy `0 <= start < end <= 1`. */
function validateCenterRange(range: Readonly<ExplorerCenterRange>): void {
    if (!Number.isFinite(range.start) ||
        !Number.isFinite(range.end) ||
        range.start < 0 ||
        range.start >= range.end ||
        range.end > 1)
        throw new RangeError("Explorer center range must satisfy 0 <= start < end <= 1");
}

/** Calculate the single final scroll position for a navigation reveal.
 *
 * A card already intersecting the configured center band prefers no movement;
 * otherwise its midpoint prefers the band's midpoint. The selected page row
 * then constrains that preferred movement so the complete row finishes inside
 * the band. If the row is taller than the band, their midpoints are aligned as
 * the only attainable analogue. Physical content bounds are applied last, so
 * the first or last entry falls back to the nearest reachable position rather
 * than introducing permanent blank scroll gutters.
 *
 * @throws {RangeError} When `centerRange` is invalid or the viewport has no
 * positive height. */
export function calculateExplorerRevealScrollTop(
    geometry: Readonly<ExplorerRevealGeometry>,
    centerRange: Readonly<ExplorerCenterRange> = DEFAULT_EXPLORER_CENTER_RANGE,
): number {
    validateCenterRange(centerRange);
    const viewportHeight = geometry.viewport.bottom - geometry.viewport.top;
    if (viewportHeight <= 0)
        throw new RangeError("Explorer viewport must have positive height");

    const centerTop = geometry.viewport.top + viewportHeight * centerRange.start;
    const centerBottom = geometry.viewport.top + viewportHeight * centerRange.end;
    const centerMidpoint = (centerTop + centerBottom) / 2;
    const cardIntersectsCenter =
        geometry.card.bottom > centerTop && geometry.card.top < centerBottom;
    let preferredDelta = cardIntersectsCenter
        ? 0
        : (geometry.card.top + geometry.card.bottom) / 2 - centerMidpoint;

    const targetHeight = geometry.target.bottom - geometry.target.top;
    const centerHeight = centerBottom - centerTop;
    if (targetHeight <= centerHeight) {
        const minimumDelta = geometry.target.bottom - centerBottom;
        const maximumDelta = geometry.target.top - centerTop;
        preferredDelta = clamp(preferredDelta, minimumDelta, maximumDelta);
    } else {
        const targetMidpoint = (geometry.target.top + geometry.target.bottom) / 2;
        preferredDelta = targetMidpoint - centerMidpoint;
    }

    const maxScrollTop = Math.max(0, geometry.maxScrollTop);
    return clamp(geometry.scrollTop + preferredDelta, 0, maxScrollTop);
}
