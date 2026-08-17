import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";
import type { RiotConnectionState } from "@/src/types/riot-connection";

export class RiotConnectionStateError extends Error {
  constructor() {
    super("Riot connection state could not be loaded.");
    this.name = "RiotConnectionStateError";
  }
}

export interface RiotAccountView {
  readonly authStatus: Database["public"]["Enums"]["auth_status"];
  readonly connectedAt: string;
  /** Resolved Riot ID such as "PlayerOne#NA1"; null until Riot supplies one. */
  readonly gameName: string | null;
  readonly id: string;
  readonly label: string | null;
  readonly lastRefreshAt: string | null;
  readonly region: string | null;
  readonly tagLine: string | null;
}

/** Every Riot account this login has connected, oldest first. */
export async function loadRiotAccountsWithClient(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<readonly RiotAccountView[]> {
  const { data, error } = await supabase
    .from("riot_connections")
    .select(
      "auth_status, created_at, game_name, id, label, last_refresh_at, region, tag_line",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new RiotConnectionStateError();
  }

  return (data ?? []).map((row) => ({
    authStatus: row.auth_status,
    connectedAt: row.created_at,
    gameName: row.game_name,
    id: row.id,
    label: row.label,
    lastRefreshAt: row.last_refresh_at,
    region: row.region,
    tagLine: row.tag_line,
  }));
}

export async function loadRiotConnectionStateWithClient(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RiotConnectionState> {
  const accounts = await loadRiotAccountsWithClient(supabase, userId);

  return accounts.some((account) => account.authStatus !== "REAUTH_REQUIRED")
    ? "connected"
    : "disconnected";
}
