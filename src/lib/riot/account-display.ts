/**
 * Presentation helpers for Riot accounts. Deliberately free of `server-only`
 * and of any Supabase import so both server and client components can name an
 * account the same way, and so the fallback chain is directly testable.
 */

export interface RiotAccountName {
  readonly gameName: string | null;
  readonly label: string | null;
  readonly tagLine: string | null;
}

/**
 * How an account is named in the UI. A resolved Riot ID wins, then the
 * user-editable label, then a stable numbered fallback so an account is never
 * nameless.
 *
 * Riot IDs are external, player-controlled strings. They are only ever
 * rendered as text, and a half-resolved pair is treated as absent rather than
 * shown as "PlayerOne#" or "#NA1".
 */
export function riotAccountDisplayName(
  account: RiotAccountName,
  index: number,
): string {
  if (account.gameName && account.tagLine) {
    return `${account.gameName}#${account.tagLine}`;
  }
  return account.label?.trim() || `Riot account ${index + 1}`;
}
