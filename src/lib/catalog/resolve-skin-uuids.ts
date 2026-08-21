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

export interface ResolvedSkinLevel {
  readonly levelUuid: string;
  readonly skinUuid: string;
}

/**
 * Best-effort variant: returns what the catalog knows and silently omits the
 * rest. The strict resolver below is right for the daily offers, where an
 * unresolvable level means the shop cannot be described honestly. It is wrong
 * for decoration — a bundle item missing from a partially synced catalog must
 * not take the dashboard down with it.
 */
export async function resolveKnownSkinLevelsWithClient(
  supabase: SupabaseClient<Database>,
  levelUuids: readonly string[],
): Promise<ResolvedSkinLevel[]> {
  const uniqueLevelUuids = [...new Set(levelUuids)];

  if (uniqueLevelUuids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("skin_levels")
    .select("level_uuid, skin_uuid")
    .in("level_uuid", uniqueLevelUuids);

  if (error) {
    return [];
  }

  return (data ?? []).map(({ level_uuid, skin_uuid }) => ({
    levelUuid: level_uuid,
    skinUuid: skin_uuid,
  }));
}

export async function resolveSkinLevelsWithClient(
  supabase: SupabaseClient<Database>,
  levelUuids: readonly string[],
): Promise<ResolvedSkinLevel[]> {
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

  return uniqueLevelUuids.map((levelUuid) => ({
    levelUuid,
    skinUuid: skinByLevel.get(levelUuid)!,
  }));
}

export async function resolveSkinUuidsWithClient(
  supabase: SupabaseClient<Database>,
  levelUuids: readonly string[],
): Promise<string[]> {
  const resolvedLevels = await resolveSkinLevelsWithClient(
    supabase,
    levelUuids,
  );
  const skinByLevel = new Map(
    resolvedLevels.map(({ levelUuid, skinUuid }) => [levelUuid, skinUuid]),
  );

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
