import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

const PAGE_SIZE = 1_000;

async function loadWatchedSkinUuidsWithScope(
  supabase: SupabaseClient<Database>,
  userId?: string,
) {
  const watchedSkinUuids: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("watchlist")
      .select("skin_uuid");

    if (userId !== undefined) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query
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

/** Uses the caller's RLS identity to scope rows. */
export async function loadWatchedSkinUuids(
  supabase: SupabaseClient<Database>,
) {
  return loadWatchedSkinUuidsWithScope(supabase);
}

/** Explicit service-role scope for per-user worker runs. */
export async function loadWatchedSkinUuidsForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  if (userId.length === 0) {
    throw new Error("A user is required to load a worker watchlist.");
  }

  return loadWatchedSkinUuidsWithScope(supabase, userId);
}
