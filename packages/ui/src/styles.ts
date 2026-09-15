/**
 * Shared style primitives, kept in one place so a design-system rule (the focus ring, the
 * technical-identifier treatment) is defined once and reused, not re-typed per component.
 *
 * Moved here from apps/site/lib/styles.ts (unchanged) when @ferryline/ui was extracted, so
 * apps/site, apps/docs, and apps/playground share one focus-ring/class-join implementation instead
 * of each redefining it — the same reason @ferryline/design-tokens itself exists.
 */

/**
 * The doc's own "Known gaps" fix, applied: the reference site itself ships zero custom focus
 * rings (every one of its 18 focus rules resolves to the browser default, `.btn:focus-visible`
 * computes to `outline: none`) — its own audit calls this out as the one real defect to fix, with
 * the exact recipe: `outline: 2px solid #000; outline-offset: 2px`, and `outline-color: #fff`
 * inside the black footer. `FOCUS_RING` is that recipe; `FOCUS_RING_ON_DARK` is the footer
 * variant. `outline-none` at rest does NOT mean "no focus indicator" — it only clears the
 * browser's own default ring so `focus-visible:outline` can draw ours instead.
 */
export const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-black focus-visible:outline-offset-2";

export const FOCUS_RING_ON_DARK =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2";

/** Joins class name fragments, dropping falsy values. No dependency for what's a one-line join. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
