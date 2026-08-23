/**
 * Local preview mode: sign-in and every database read are replaced by
 * fixtures, so the dashboard can be looked at on a laptop with no Supabase
 * credentials and no connected Riot account.
 *
 * This bypasses authentication, so it is gated three independent ways and
 * every one of them must hold:
 *
 *   1. NODE_ENV === "development" — set by `next dev` only. `next build`,
 *      `next start`, and every Vercel build are "production".
 *   2. VERCEL is unset — belt and braces, since Vercel always defines it.
 *   3. VAL_CHECKER_DEV_PREVIEW === "1" — explicit opt-in, so a stray
 *      development build does not silently authenticate anybody.
 *
 * Any single gate would be enough on its own; the point is that no plausible
 * misconfiguration trips all three. Do not relax this to fewer conditions,
 * and do not read it from anything a request can influence.
 */
export function isDevPreview(): boolean {
  const flag = process.env.VAL_CHECKER_DEV_PREVIEW;
  return (
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL === undefined &&
    (flag === "1" || flag === "night-market" || flag === "empty")
  );
}

/**
 * Whether the preview should pretend no Riot account is connected.
 *
 * Same reason the night market has a flag: the preview fixtures always carry
 * two accounts, so the "connect your first account" state and the skin ring
 * under it are otherwise impossible to look at locally.
 */
export function isDevPreviewEmptyState(): boolean {
  return isDevPreview() && process.env.VAL_CHECKER_DEV_PREVIEW === "empty";
}

/**
 * Whether the preview should fabricate a running night market.
 *
 * Off by default, so the local dashboard shows what a normal day shows. Riot
 * runs a night market a few weeks a year, and the panel is otherwise
 * impossible to look at, so `VAL_CHECKER_DEV_PREVIEW=night-market` opts into
 * one deliberately.
 */
export function isDevPreviewNightMarket(): boolean {
  return isDevPreview() && process.env.VAL_CHECKER_DEV_PREVIEW === "night-market";
}

/** The signed-in identity the preview pretends to be. */
export const DEV_PREVIEW_EMAIL = "preview@localhost";
