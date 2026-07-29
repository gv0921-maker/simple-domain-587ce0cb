/**
 * Collision-aware placement maths for design-system popovers.
 *
 * Pure functions over plain numbers — no DOM access, no React — so the
 * behaviour is testable and the design system keeps its dependency isolation
 * (react, lucide-react, clsx, tailwind-merge and nothing else).
 *
 * The convention throughout: callers measure an element's *natural* geometry
 * (its position with any previously applied shift subtracted back out) and
 * these functions return the correction to apply. Feeding a natural rect in
 * means the result is stable — re-measuring after applying a shift yields the
 * same answer rather than drifting further each pass.
 */

/** Breathing room kept between a flyout and the viewport edge, in px. */
export const VIEWPORT_MARGIN = 8;

export type Side = 'left' | 'right';

/**
 * Which side a flyout of `flyoutWidth` should open on, given the anchor it
 * hangs off and a `gap` between the two.
 *
 * Prefers `right` (the conventional reading direction for a submenu) and only
 * flips when the right placement would overflow and the left one would not.
 * When neither side fits — a viewport narrower than the flyout — it picks the
 * side with more room, so the overflow is at least minimised and part of the
 * menu stays reachable.
 */
export function chooseSide(
  anchorLeft: number,
  anchorRight: number,
  flyoutWidth: number,
  viewportWidth: number,
  gap = 4,
  margin = VIEWPORT_MARGIN,
): Side {
  const fitsRight = anchorRight + gap + flyoutWidth <= viewportWidth - margin;
  if (fitsRight) return 'right';

  const fitsLeft = anchorLeft - gap - flyoutWidth >= margin;
  if (fitsLeft) return 'left';

  // Neither fits: choose the roomier side.
  const roomRight = viewportWidth - margin - (anchorRight + gap);
  const roomLeft = anchorLeft - gap - margin;
  return roomLeft > roomRight ? 'left' : 'right';
}

/**
 * How far to move a box vertically so it sits inside the viewport.
 *
 * Returns a delta in px: negative shifts up, positive shifts down, 0 means it
 * already fits. Keeping the top edge visible wins over showing the bottom — a
 * box taller than the viewport is pinned to the top and scrolls off the bottom,
 * which is the lesser evil since menus are read top-down.
 */
export function verticalShift(
  naturalTop: number,
  naturalBottom: number,
  viewportHeight: number,
  margin = VIEWPORT_MARGIN,
): number {
  const overflowBottom = naturalBottom - (viewportHeight - margin);
  if (overflowBottom <= 0) {
    // Already fits at the bottom; it may still be clipped at the top.
    return naturalTop < margin ? margin - naturalTop : 0;
  }

  // Shift up by the overflow, but never so far that the top clips.
  const shift = -overflowBottom;
  const topAfter = naturalTop + shift;
  return topAfter < margin ? margin - naturalTop : shift;
}
