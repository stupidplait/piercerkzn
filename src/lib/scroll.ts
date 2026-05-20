/**
 * scrollToSection — dispatches a custom event the root page listens for
 * inside its smooth-scroll loop. Native scroll APIs (scrollTo / scrollIntoView)
 * fight the page's exponential-decay loop because the loop re-asserts
 * scrollY every frame; routing through targetScroll keeps animations smooth.
 *
 * Falls back to native scrollIntoView if the page-level handler is absent
 * (e.g. on a sub-route that doesn't run the smooth-scroll loop).
 */
export const SCROLL_EVENT = "piercer:scroll-to";

export function scrollToSection(id: string) {
    if (typeof window === "undefined") return;
    const ev = new CustomEvent(SCROLL_EVENT, { detail: { id }, cancelable: true });
    const handled = !window.dispatchEvent(ev);
    if (!handled) {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}
