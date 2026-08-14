import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import type { Database } from "@/src/types/database";

export const SKIN_LEVEL_ITEM_TYPE_ID =
  "e7c63390-eda7-46e0-bb7a-a6abdacd2433";

export class UnknownSkinLevelsError extends Error {
  readonly unknownLevelUuids: readonly string[];

  constructor(unknownLevelUuids: readonly string[]) {
    super(
      `${unknownLevelUuids.length} storefront skin level UUID${unknownLevelUuids.length === 1 ? " is" : "s are"} missing from the catalog.`,
    );
    this.name = "UnknownSkinLevelsError";
    this.unknownLevelUuids = unknownLevelUuids;
  }
}

export async function resolveSkinUuidsWithClient(
  supabase: SupabaseClient<Database>,
  levelUuids: readonly string[],
): Promise<string[]> {
  const uniqueLevelUuids = [...new Set(levelUuids)];

  if (uniqueLevelUuids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("skin_levels")
    .select("level_uuid, skin_uuid")
    .in("level_uuid", uniqueLevelUuids);

  if (error) {
    throw new Error("Skin UUID resolution failed while reading the catalog.");
  }

  const skinByLevel = new Map(
    (data ?? []).map(({ level_uuid, skin_uuid }) => [level_uuid, skin_uuid]),
  );
  const unknownLevelUuids = uniqueLevelUuids.filter(
    (levelUuid) => !skinByLevel.has(levelUuid),
  );

  if (unknownLevelUuids.length > 0) {
    throw new UnknownSkinLevelsError(unknownLevelUuids);
  }

  const resolvedSkinUuids: string[] = [];
  const seenSkinUuids = new Set<string>();

  for (const levelUuid of levelUuids) {
    const skinUuid = skinByLevel.get(levelUuid);

    if (skinUuid && !seenSkinUuids.has(skinUuid)) {
      seenSkinUuids.add(skinUuid);
      resolvedSkinUuids.push(skinUuid);
    }
  }

  return resolvedSkinUuids;
}

export async function resolveSkinUuids(levelUuids: string[]): Promise<string[]> {
  return resolveSkinUuidsWithClient(createAdminSupabaseClient(), levelUuids);
}
