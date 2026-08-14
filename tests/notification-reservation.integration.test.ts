import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Database } from "@/src/types/database";

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
    throw new Error(
      "The local Supabase stack must be running for notification reservation tests.",
    );
  }
}

describe("storefront notification reservation", () => {
  it(
    "atomically reuses one shop check and notification per UTC rotation",
    async () => {
      const status = localSupabaseStatus();
      const admin = createClient<Database>(
        status.API_URL,
        status.SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        },
      );
      const anon = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
      const identity = randomUUID();
      const weaponUuid = randomUUID();
      const skinUuid = randomUUID();
      let userId: string | undefined;

      try {
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email: `notification-reservation-${identity}@example.test`,
            email_confirm: true,
          });
        expect(createError).toBeNull();
        expect(created.user).not.toBeNull();
        userId = created.user?.id;
        if (!userId) {
          throw new Error("Unable to create a notification reservation user.");
        }

        expect(
          (
            await admin.from("weapons").insert({
              category: "Rifle",
              display_name: "Notification reservation fixture",
              weapon_uuid: weaponUuid,
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await admin.from("skins").insert({
              content_tier: null,
              display_icon: null,
              display_name: "Notification reservation fixture",
              skin_uuid: skinUuid,
              weapon_uuid: weaponUuid,
            })
          ).error,
        ).toBeNull();
        const { data: connection, error: connectionError } = await admin
          .from("riot_connections")
          .insert({
            encrypted_jar: "\\x00",
            jar_nonce: "\\x00",
            user_id: userId,
          })
          .select("id")
          .single();
        expect(connectionError).toBeNull();
        expect(connection).not.toBeNull();
        if (!connection) {
          throw new Error("Unable to create a notification reservation connection.");
        }

        const args = {
          p_checked_at: "2026-08-14T00:05:00.000Z",
          p_connection_id: connection.id,
          p_expires_at: "2026-08-15T00:00:00.000Z",
          p_offer_skin_uuids: [skinUuid],
          p_rotation_date: "2026-08-14",
          p_shop_hash: "a".repeat(64),
          p_skin_uuid: skinUuid,
          p_user_id: userId,
        };
        const first = await admin.rpc(
          "reserve_storefront_notification",
          args,
        );
        const second = await admin.rpc(
          "reserve_storefront_notification",
          args,
        );

        expect(first.error).toBeNull();
        expect(second.error).toBeNull();
        expect(first.data).toHaveLength(1);
        expect(second.data).toEqual(first.data);
        const reservation = first.data?.[0];
        expect(reservation?.notification_emailed_at).toBeNull();

        const [checks, notifications] = await Promise.all([
          admin
            .from("shop_checks")
            .select("id, rotation_date")
            .eq("connection_id", connection.id)
            .eq("rotation_date", "2026-08-14"),
          admin
            .from("notifications")
            .select("id, emailed_at")
            .eq("user_id", userId)
            .eq("skin_uuid", skinUuid),
        ]);
        expect(checks.error).toBeNull();
        expect(checks.data).toEqual([
          {
            id: reservation?.shop_check_id,
            rotation_date: "2026-08-14",
          },
        ]);
        expect(notifications.error).toBeNull();
        expect(notifications.data).toEqual([
          { emailed_at: null, id: reservation?.notification_id },
        ]);

        const emailedAt = "2026-08-14T00:06:00.000Z";
        expect(
          (
            await admin
              .from("notifications")
              .update({ emailed_at: emailedAt })
              .eq("id", reservation!.notification_id)
          ).error,
        ).toBeNull();
        const afterAcceptance = await admin.rpc(
          "reserve_storefront_notification",
          args,
        );
        expect(afterAcceptance.error).toBeNull();
        expect(
          new Date(
            afterAcceptance.data?.[0].notification_emailed_at ?? "",
          ).toISOString(),
        ).toBe(emailedAt);

        const directDuplicate = await admin.from("shop_checks").insert({
          connection_id: connection.id,
          rotation_date: "2026-08-14",
          shop_hash: "b".repeat(64),
        });
        expect(directDuplicate.error).not.toBeNull();

        const mismatchedDate = await admin.rpc(
          "reserve_storefront_notification",
          { ...args, p_rotation_date: "2026-08-13" },
        );
        expect(mismatchedDate.error).not.toBeNull();

        const wrongOwner = await admin.rpc(
          "reserve_storefront_notification",
          { ...args, p_user_id: randomUUID() },
        );
        expect(wrongOwner.error).not.toBeNull();

        const publicCall = await anon.rpc(
          "reserve_storefront_notification",
          args,
        );
        expect(publicCall.error).not.toBeNull();
      } finally {
        if (userId) {
          await admin.auth.admin.deleteUser(userId);
        }
        await admin.from("skins").delete().eq("skin_uuid", skinUuid);
        await admin.from("weapons").delete().eq("weapon_uuid", weaponUuid);
      }
    },
    60_000,
  );
});
