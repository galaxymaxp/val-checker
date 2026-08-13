"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { WatchMutationResult } from "@/src/types/watchlist";

const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

export async function setSkinWatched(
  skinUuid: string,
  watched: boolean,
): Promise<WatchMutationResult> {
  const parsedSkinUuid = databaseUuidSchema.safeParse(skinUuid);

  if (!parsedSkinUuid.success) {
    return { error: "This skin is not valid.", ok: false };
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const { error } = watched
    ? await supabase.from("watchlist").insert({
        skin_uuid: parsedSkinUuid.data,
        user_id: userId,
      })
    : await supabase
        .from("watchlist")
        .delete()
        .eq("user_id", userId)
        .eq("skin_uuid", parsedSkinUuid.data);

  if (error) {
    return { error: "Your watchlist could not be updated.", ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
