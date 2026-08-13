import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

import type { CatalogSnapshot } from "./valorant-api";

const BATCH_SIZE = 500;

function batches<Row>(rows: readonly Row[]) {
  const result: Row[][] = [];

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    result.push(rows.slice(offset, offset + BATCH_SIZE));
  }

  return result;
}

async function upsertRows<Row>(
  rows: readonly Row[],
  table: string,
  write: (batch: Row[]) => Promise<{ error: unknown }>,
) {
  for (const batch of batches(rows)) {
    const { error } = await write(batch);

    if (error) {
      throw new Error(`Catalog sync failed while writing ${table}.`);
    }
  }
}

export async function syncCatalog(
  supabase: SupabaseClient<Database>,
  snapshot: CatalogSnapshot,
) {
  await upsertRows(snapshot.weapons, "weapons", async (batch) => {
    return supabase.from("weapons").upsert(batch, { onConflict: "weapon_uuid" });
  });
  await upsertRows(snapshot.skins, "skins", async (batch) => {
    return supabase.from("skins").upsert(batch, { onConflict: "skin_uuid" });
  });
  await upsertRows(snapshot.skinLevels, "skin_levels", async (batch) => {
    return supabase.from("skin_levels").upsert(batch, { onConflict: "level_uuid" });
  });

  return {
    skinLevels: snapshot.skinLevels.length,
    skins: snapshot.skins.length,
    weapons: snapshot.weapons.length,
  };
}
