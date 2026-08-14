"use server";

import { revalidatePath } from "next/cache";

import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

export async function disconnectRiotSession(): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("riot_connections")
    .delete()
    .eq("user_id", userId);

  if (error) {
    return { error: "The Riot session could not be disconnected.", ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
