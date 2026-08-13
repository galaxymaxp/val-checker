import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

import { getPublicSupabaseConfig } from "./public-env";
import { getElevatedSupabaseKey } from "./server-env";

export function createAdminSupabaseClient() {
  const { url } = getPublicSupabaseConfig();

  return createClient<Database>(url, getElevatedSupabaseKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
