import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const localStatusSchema = z.object({
  ANON_KEY: z.string().min(1),
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
    throw new Error("The local Supabase stack must be running for RLS integration tests.");
  }
}

function makeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createSignedInUser(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
) {
  const identity = randomUUID();
  const email = `rls-${identity}@example.test`;
  const password = `Local-only-${identity}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });

  if (createError || !created.user) {
    throw new Error("Unable to create a local RLS test user.");
  }

  const client = makeClient(url, anonKey);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });

  if (signInError) {
    throw new Error("Unable to sign in a local RLS test user.");
  }

  return { client, email, password, userId: created.user.id };
}

describe("foundation schema RLS", () => {
  it(
    "enforces catalog, watchlist, and service-only boundaries with real user JWTs",
    async () => {
      const status = localSupabaseStatus();
      const admin = makeClient(status.API_URL, status.SERVICE_ROLE_KEY);
      const [userA, userB] = await Promise.all([
        createSignedInUser(admin, status.API_URL, status.ANON_KEY),
        createSignedInUser(admin, status.API_URL, status.ANON_KEY),
      ]);
      const weaponUuid = randomUUID();
      const skinUuid = randomUUID();
      const levelUuid = randomUUID();

      const { error: weaponSeedError } = await admin.from("weapons").insert({
        category: "Rifle",
        display_name: "RLS fixture weapon",
        weapon_uuid: weaponUuid,
      });
      expect(weaponSeedError, "service role seeds weapons").toBeNull();

      const { error: skinSeedError } = await admin.from("skins").insert({
        content_tier: "Exclusive",
        display_icon: null,
        display_name: "RLS fixture skin",
        skin_uuid: skinUuid,
        weapon_uuid: weaponUuid,
      });
      expect(skinSeedError, "service role seeds skins").toBeNull();

      const { error: levelSeedError } = await admin.from("skin_levels").insert({
        level_uuid: levelUuid,
        ordinal: 0,
        skin_uuid: skinUuid,
      });
      expect(levelSeedError, "service role seeds skin levels").toBeNull();

      const { data: connection, error: connectionError } = await admin
        .from("riot_connections")
        .insert({
          encrypted_jar: "\\x00",
          jar_nonce: "\\x00",
          user_id: userA.userId,
        })
        .select("id")
        .single();
      if (connectionError || !connection) {
        throw new Error("Unable to seed the Riot connection fixture.");
      }

      const { error: shopSeedError } = await admin.from("shop_checks").insert({
        connection_id: connection.id,
        rotation_date: "2026-08-14",
        shop_hash: randomUUID(),
      });
      expect(shopSeedError, "service role seeds a shop check").toBeNull();

      for (const { client } of [userA, userB]) {
        const [weapons, skins, levels] = await Promise.all([
          client.from("weapons").select("weapon_uuid").eq("weapon_uuid", weaponUuid),
          client.from("skins").select("skin_uuid").eq("skin_uuid", skinUuid),
          client.from("skin_levels").select("level_uuid").eq("level_uuid", levelUuid),
        ]);

        expect(weapons.error).toBeNull();
        expect(weapons.data).toHaveLength(1);
        expect(skins.error).toBeNull();
        expect(skins.data).toHaveLength(1);
        expect(levels.error).toBeNull();
        expect(levels.data).toHaveLength(1);
      }

      const catalogInsertErrors = await Promise.all([
        userA.client.from("weapons").insert({
          display_name: "denied",
          weapon_uuid: randomUUID(),
        }),
        userA.client.from("skins").insert({
          display_name: "denied",
          skin_uuid: randomUUID(),
          weapon_uuid: weaponUuid,
        }),
        userA.client.from("skin_levels").insert({
          level_uuid: randomUUID(),
          skin_uuid: skinUuid,
        }),
      ]);
      expect(catalogInsertErrors.every(({ error }) => error !== null)).toBe(true);

      const { error: ownInsertError } = await userA.client.from("watchlist").insert({
        skin_uuid: skinUuid,
        user_id: userA.userId,
      });
      expect(ownInsertError).toBeNull();

      const { error: crossUserInsertError } = await userA.client.from("watchlist").insert({
        skin_uuid: skinUuid,
        user_id: userB.userId,
      });
      expect(crossUserInsertError).not.toBeNull();

      const { error: userBInsertError } = await userB.client.from("watchlist").insert({
        skin_uuid: skinUuid,
        user_id: userB.userId,
      });
      expect(userBInsertError).toBeNull();

      const [watchlistA, watchlistB] = await Promise.all([
        userA.client.from("watchlist").select("user_id, skin_uuid"),
        userB.client.from("watchlist").select("user_id, skin_uuid"),
      ]);
      expect(watchlistA.error).toBeNull();
      expect(watchlistA.data).toEqual([{ user_id: userA.userId, skin_uuid: skinUuid }]);
      expect(watchlistB.error).toBeNull();
      expect(watchlistB.data).toEqual([{ user_id: userB.userId, skin_uuid: skinUuid }]);

      const reloadedUserA = makeClient(status.API_URL, status.ANON_KEY);
      const { error: reloadSignInError } = await reloadedUserA.auth.signInWithPassword({
        email: userA.email,
        password: userA.password,
      });
      expect(reloadSignInError).toBeNull();
      const reloadedWatchlistA = await reloadedUserA
        .from("watchlist")
        .select("user_id, skin_uuid");
      expect(reloadedWatchlistA.error).toBeNull();
      expect(reloadedWatchlistA.data).toEqual([
        { user_id: userA.userId, skin_uuid: skinUuid },
      ]);

      const { error: crossUserDeleteError } = await userB.client
        .from("watchlist")
        .delete()
        .eq("user_id", userA.userId)
        .eq("skin_uuid", skinUuid);
      expect(crossUserDeleteError).toBeNull();
      const watchlistAfterCrossUserDelete = await reloadedUserA
        .from("watchlist")
        .select("user_id, skin_uuid");
      expect(watchlistAfterCrossUserDelete.error).toBeNull();
      expect(watchlistAfterCrossUserDelete.data).toEqual([
        { user_id: userA.userId, skin_uuid: skinUuid },
      ]);

      for (const client of [userA.client, userB.client]) {
        const [connections, checks] = await Promise.all([
          client.from("riot_connections").select("id"),
          client.from("shop_checks").select("id"),
        ]);
        const connectionIsDenied = connections.error !== null || connections.data?.length === 0;
        const checksAreDenied = checks.error !== null || checks.data?.length === 0;

        expect(connectionIsDenied).toBe(true);
        expect(checksAreDenied).toBe(true);
      }
    },
    60_000,
  );
});
