import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/src/types/database";

import { getPublicSupabaseConfig } from "./public-env";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { key, url } = getPublicSupabaseConfig();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, options, value } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Phase 1.4's proxy refreshes them.
        }
      },
    },
  });
}
