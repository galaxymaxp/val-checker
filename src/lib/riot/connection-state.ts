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

export async function loadRiotConnectionStateWithClient(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RiotConnectionState> {
  const { data, error } = await supabase
    .from("riot_connections")
    .select("auth_status, id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new RiotConnectionStateError();
  }

  return data && data.auth_status !== "REAUTH_REQUIRED"
    ? "connected"
    : "disconnected";
}
