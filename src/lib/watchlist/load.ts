import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

const PAGE_SIZE = 1_000;

export async function loadWatchedSkinUuids(supabase: SupabaseClient<Database>) {
  const watchedSkinUuids: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("watchlist")
      .select("skin_uuid")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error("Watchlist could not be loaded.");
    }

    watchedSkinUuids.push(...(data ?? []).map(({ skin_uuid }) => skin_uuid));

    if (!data || data.length < PAGE_SIZE) {
      return watchedSkinUuids;
    }
  }
}
