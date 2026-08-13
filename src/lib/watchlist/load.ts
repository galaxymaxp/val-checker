import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

export async function loadWatchedSkinUuids(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("watchlist")
    .select("skin_uuid")
    .order("created_at");

  if (error) {
    throw new Error("Watchlist could not be loaded.");
  }

  return (data ?? []).map(({ skin_uuid }) => skin_uuid);
}
