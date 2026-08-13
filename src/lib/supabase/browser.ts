import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "./public-env";

export function createBrowserSupabaseClient() {
  const { key, url } = getPublicSupabaseConfig();

  return createBrowserClient(url, key);
}
