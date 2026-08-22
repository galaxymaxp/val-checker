const RIOT_CALLBACK_HOST = "playvalorant.com";
const RIOT_CALLBACK_PAGE = "opt_in";
const RIOT_LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/i;

function isRiotCallbackPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.at(-1)?.toLowerCase() !== RIOT_CALLBACK_PAGE) {
    return false;
  }

  // Riot currently uses /opt_in and localized variants such as
  // /en-us/opt_in/. A trailing slash is intentionally accepted.
  return (
    segments.length === 1 ||
    (segments.length === 2 && RIOT_LOCALE_SEGMENT.test(segments[0]))
  );
}

/**
 * Classifies Riot's OAuth callback without returning, logging, or persisting
 * any fragment value. The callback page may render a 404; the URL is the
 * authentication result and is sufficient for the extension handoff.
 */
export function classifyRiotAuthCallback(url) {
  if (typeof url !== "string") return null;

  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }

  if (
    target.protocol !== "https:" ||
    target.hostname !== RIOT_CALLBACK_HOST ||
    !isRiotCallbackPath(target.pathname)
  ) {
    return null;
  }

  const fragment = new URLSearchParams(target.hash.slice(1));
  if (fragment.has("error") || target.searchParams.has("error")) {
    return "denied";
  }

  return fragment.has("access_token") && fragment.get("access_token") !== ""
    ? "completed"
    : null;
}
