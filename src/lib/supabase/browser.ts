import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "./public-env";

export function createBrowserSupabaseClient() {
  const { key, url } = getPublicSupabaseConfig();

  return createBrowserClient(url, key);
}

/**
 * Client used only to request an emailed sign-in link.
 *
 * createBrowserClient hard-codes flowType "pkce" after spreading caller
 * options, and PKCE keeps a code_verifier in the requesting browser. An emailed
 * link opened anywhere else then fails with "invalid flow state, no valid flow
 * state found". Going through supabase-js directly keeps the link
 * self-contained, so it works in whichever browser opens the mail. It holds no
 * session: /auth/confirm establishes that server side as cookies.
 */
export function createMagicLinkRequestClient() {
  const { key, url } = getPublicSupabaseConfig();

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      persistSession: false,
    },
  });
}
