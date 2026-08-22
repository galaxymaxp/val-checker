import "server-only";

import type { RiotConnectIdentity } from "@/src/lib/riot/connect-identity";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export async function resolveCloudConnectIdentity(): Promise<RiotConnectIdentity | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (typeof claims?.sub !== "string") {
    return null;
  }
  return { userId: claims.sub };
}
