import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSkinUuidsWithClient } from "@/src/lib/catalog/resolve-skin-uuids";
import { extractStorefrontSkinLevelUuids } from "@/src/lib/storefront/schema";
import type { Database } from "@/src/types/database";

export async function resolveStorefrontSkinUuidsWithClient(
  supabase: SupabaseClient<Database>,
  payload: unknown,
): Promise<string[]> {
  const levelUuids = extractStorefrontSkinLevelUuids(payload);
  return resolveSkinUuidsWithClient(supabase, levelUuids);
}
