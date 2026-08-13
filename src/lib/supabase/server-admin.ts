import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "./public-env";
import { getElevatedSupabaseKey } from "./server-env";

export function createAdminSupabaseClient() {
  const { url } = getPublicSupabaseConfig();

  return createClient(url, getElevatedSupabaseKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
