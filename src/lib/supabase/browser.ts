import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "./public-env";

export function createBrowserSupabaseClient() {
  const { key, url } = getPublicSupabaseConfig();

  return createBrowserClient(url, key, {
    auth: {
      // Emailed sign-in links must open in any browser, not only the one that
      // requested them. PKCE stores a code_verifier in the requesting browser,
      // so opening the link elsewhere -- or in a browser that partitions the
      // cookie -- fails with "invalid flow state". The implicit flow issues a
      // self-contained token that /auth/confirm verifies server side.
      flowType: "implicit",
    },
  });
}
