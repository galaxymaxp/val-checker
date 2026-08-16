import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  CatalogSnapshot,
  ContentTierSnapshot,
} from "@/src/lib/catalog/valorant-api";
import { syncCatalog } from "@/src/lib/catalog/sync";
import type { Database } from "@/src/types/database";

const localStatusSchema = z.object({
  API_URL: z.url(),
  SERVICE_ROLE_KEY: z.string().min(1),
});

function localSupabaseStatus() {
  const root = process.cwd();
  const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
  const environment = { ...process.env };

  if (process.platform === "win32" && environment.LOCALAPPDATA) {
    const dockerBin = path.join(
      environment.LOCALAPPDATA,
      "Programs",
      "DockerDesktop",
      "resources",
      "bin",
    );
    environment.PATH = `${dockerBin}${path.delimiter}${environment.PATH ?? ""}`;
  }

  try {
    const output = execFileSync(
      process.execPath,
      [cli, "--workdir", root, "status", "-o", "json"],
      {
        cwd: root,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return localStatusSchema.parse(JSON.parse(output));
  } catch {
    throw new Error("The local Supabase stack must be running for catalog sync tests.");
  }
}

async function catalogCounts(supabase: ReturnType<typeof createClient<Database>>) {
  const [weapons, skins, levels, chromas, tiers] = await Promise.all([
    supabase.from("weapons").select("*", { count: "exact", head: true }),
    supabase.from("skins").select("*", { count: "exact", head: true }),
    supabase.from("skin_levels").select("*", { count: "exact", head: true }),
    supabase.from("skin_chromas").select("*", { count: "exact", head: true }),
    supabase.from("content_tiers").select("*", { count: "exact", head: true }),
  ]);

  expect(weapons.error).toBeNull();
  expect(skins.error).toBeNull();
  expect(levels.error).toBeNull();
  expect(chromas.error).toBeNull();
  expect(tiers.error).toBeNull();

  return {
    contentTiers: tiers.count,
    skinChromas: chromas.count,
    skinLevels: levels.count,
    skins: skins.count,
    weapons: weapons.count,
  };
}

describe("catalog sync", () => {
  it("is idempotent and preserves first-seen timestamps", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const weaponUuid = randomUUID();
    const skinUuid = randomUUID();
    const levelUuid = randomUUID();
    const chromaUuid = randomUUID();
    const contentTierUuid = randomUUID();
    const defaultSkinUuid = randomUUID();
    const snapshot: CatalogSnapshot = {
      weapons: [
        {
          category: "Rifle",
          default_skin_uuid: defaultSkinUuid,
          display_icon: null,
          display_name: "Sync fixture",
          inventory_label: "RIFLES",
          inventory_ordinal: 2,
          shop_category: "Rifles",
          weapon_uuid: weaponUuid,
        },
      ],
      skins: [
        {
          content_tier_uuid: contentTierUuid,
          display_icon: null,
          display_name: "Sync fixture skin",
          full_render: null,
          skin_uuid: skinUuid,
          theme_uuid: null,
          wallpaper: null,
          weapon_uuid: weaponUuid,
        },
      ],
      skinLevels: [
        {
          display_icon: null,
          display_name: "Sync fixture skin",
          level_item: null,
          level_uuid: levelUuid,
          ordinal: 0,
          skin_uuid: skinUuid,
          streamed_video: null,
        },
      ],
      skinChromas: [
        {
          chroma_uuid: chromaUuid,
          display_icon: null,
          display_name: "Sync fixture skin",
          full_render: "https://example.test/sync-fixture-full.png",
          ordinal: 0,
          skin_uuid: skinUuid,
          streamed_video: null,
          swatch: null,
          variant_label: null,
        },
      ],
    };
    const tierSnapshot: ContentTierSnapshot = {
      contentTiers: [
        {
          content_tier_uuid: contentTierUuid,
          dev_name: "Exclusive",
          display_icon: null,
          display_name: "Exclusive Edition",
          highlight_color: "f5955bff",
          rank: 4,
        },
      ],
    };

    await syncCatalog(admin, snapshot, tierSnapshot);
    const countsAfterFirstSync = await catalogCounts(admin);
    const { data: firstSeen, error: firstSeenError } = await admin
      .from("skins")
      .select("first_seen_at")
      .eq("skin_uuid", skinUuid)
      .single();
    const { data: firstLevelSeen, error: firstLevelSeenError } = await admin
      .from("skin_levels")
      .select("first_seen_at")
      .eq("level_uuid", levelUuid)
      .single();

    expect(firstSeenError).toBeNull();
    expect(firstLevelSeenError).toBeNull();

    await syncCatalog(
      admin,
      {
        ...snapshot,
        skins: [{ ...snapshot.skins[0], display_name: "Sync fixture skin updated" }],
      },
      tierSnapshot,
    );

    const countsAfterSecondSync = await catalogCounts(admin);
    const { data: secondSeen, error: secondSeenError } = await admin
      .from("skins")
      .select("display_name, first_seen_at")
      .eq("skin_uuid", skinUuid)
      .single();
    const { data: secondLevelSeen, error: secondLevelSeenError } = await admin
      .from("skin_levels")
      .select("first_seen_at")
      .eq("level_uuid", levelUuid)
      .single();

    expect(secondSeenError).toBeNull();
    expect(secondLevelSeenError).toBeNull();
    expect(countsAfterSecondSync).toEqual(countsAfterFirstSync);
    expect(secondSeen?.display_name).toBe("Sync fixture skin updated");
    expect(secondSeen?.first_seen_at).toBe(firstSeen?.first_seen_at);
    expect(secondLevelSeen?.first_seen_at).toBe(firstLevelSeen?.first_seen_at);
  });
});
