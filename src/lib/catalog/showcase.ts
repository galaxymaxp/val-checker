import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ShowcaseSkinView } from "@/src/types/catalog-view";
import type { Database } from "@/src/types/database";

/**
 * How many skins the empty-state ring draws from. The ring shows ten at a
 * time and replaces one every few seconds, so the pool only has to be big
 * enough that a swap rarely brings back something already on screen.
 */
const POOL_SIZE = 34;

/** Catalog rows read before the pool is drawn out of them. */
const WINDOW_SIZE = 240;

function shuffled<T>(values: readonly T[]): T[] {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }

  return copy;
}

/**
 * Draws a random handful of tiered skins for the "connect your first account"
 * showcase.
 *
 * The tier filter is what keeps the ring looking like a store: default and
 * battlepass skins carry no content tier, and a ring of grey stock weapons
 * sells nothing. Rows are ordered by `skin_uuid` -- effectively random -- so
 * one contiguous window is already a fair sample of the catalog, and the
 * window's offset is randomised so two visits do not draw the same one.
 *
 * The section is decorative, so a failed read returns an empty pool and the
 * caller drops it rather than failing the whole dashboard.
 */
export async function loadShowcaseSkins(
  supabase: SupabaseClient<Database>,
): Promise<readonly ShowcaseSkinView[]> {
  const { count, error: countError } = await supabase
    .from("skins")
    .select("skin_uuid", { count: "exact", head: true })
    .not("content_tier_uuid", "is", null)
    .not("display_icon", "is", null);

  if (countError || !count) {
    return [];
  }

  const offset = Math.floor(
    Math.random() * Math.max(1, count - WINDOW_SIZE + 1),
  );

  const { data, error } = await supabase
    .from("skins")
    .select("skin_uuid, display_name, display_icon")
    .not("content_tier_uuid", "is", null)
    .not("display_icon", "is", null)
    .order("skin_uuid", { ascending: true })
    .range(offset, offset + WINDOW_SIZE - 1);

  if (error || !data) {
    return [];
  }

  const pool = data.flatMap((row): ShowcaseSkinView[] =>
    row.display_icon
      ? [
          {
            displayIcon: row.display_icon,
            displayName: row.display_name,
            skinUuid: row.skin_uuid,
          },
        ]
      : [],
  );

  return shuffled(pool).slice(0, POOL_SIZE);
}
