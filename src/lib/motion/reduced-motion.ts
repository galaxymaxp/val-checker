const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionMediaQuery(): MediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/**
 * Whether the environment prefers reduced motion. Unknown environments (SSR,
 * missing matchMedia) report true: no motion is the safe default.
 */
export function prefersReducedMotion(): boolean {
  const query = reducedMotionMediaQuery();

  return query ? query.matches : true;
}

/**
 * Invokes the callback whenever the reduced-motion preference changes.
 * Returns an unsubscribe function; a no-op unsubscriber on environments
 * without matchMedia.
 */
export function subscribeReducedMotion(callback: () => void): () => void {
  const query = reducedMotionMediaQuery();

  if (!query) return () => {};

  const listener = () => callback();
  query.addEventListener("change", listener);

  return () => query.removeEventListener("change", listener);
}
