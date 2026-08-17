import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Database } from "@/src/types/database";

const statusSchema = z.object({
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
  return statusSchema.parse(
    JSON.parse(
      execFileSync(process.execPath, [cli, "--workdir", root, "status", "-o", "json"], {
        cwd: root,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ),
  );
}

describe("service-only Riot daily run gate", () => {
  it("atomically claims and marks once, fences epochs, and survives reconnect", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient<Database>(status.API_URL, status.ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: `daily-run-${randomUUID()}@example.test`,
        email_confirm: true,
      });
    expect(createError).toBeNull();
    const userId = created.user?.id;
    if (!userId) {
      throw new Error("Unable to create daily-run test user.");
    }

    try {
      const { data: connection, error: connectionError } = await admin
        .from("riot_connections")
        .insert({ encrypted_jar: "\\x00", jar_nonce: "\\x00", user_id: userId })
        .select("connection_epoch, id")
        .single();
      expect(connectionError).toBeNull();
      if (!connection) {
        throw new Error("Unable to create daily-run test connection.");
      }
      const connectionArgs = {
        p_connection_epoch: connection.connection_epoch,
        p_connection_id: connection.id,
        p_user_id: userId,
      };

      const rotationLease = await admin.rpc(
        "claim_riot_session_rotation",
        connectionArgs,
      );
      expect(rotationLease.error).toBeNull();
      expect(rotationLease.data).toHaveLength(1);
      expect(rotationLease.data?.[0]?.lease_status).toBe("acquired");
      const rotationLeaseToken = rotationLease.data?.[0]?.lease_token;
      if (!rotationLeaseToken) {
        throw new Error("Unable to acquire the session-rotation test lease.");
      }
      const args = {
        ...connectionArgs,
        p_rotation_lease_token: rotationLeaseToken,
      };

      const claims = await Promise.all(
        Array.from({ length: 8 }, () => admin.rpc("claim_riot_daily_run", args)),
      );
      expect(claims.map(({ error }) => error?.message ?? null)).toEqual(
        Array.from({ length: 8 }, () => null),
      );
      expect(claims.filter(({ data, error }) => !error && data?.length === 1)).toHaveLength(1);
      const claimed = claims.flatMap(({ data }) => data ?? [])[0];
      expect(claimed).toBeDefined();
      expect(claimed.store_date).toBe(claimed.claimed_at.slice(0, 10));

      const staleEpoch = randomUUID();
      expect(
        (
          await admin
            .from("riot_connections")
            .update({ connection_epoch: staleEpoch })
            .eq("id", connection.id)
        ).error,
      ).toBeNull();
      const staleMark = await admin.rpc("mark_riot_storefront_attempt", {
        p_connection_epoch: connection.connection_epoch,
        p_connection_id: connection.id,
        p_rotation_lease_token: rotationLeaseToken,
        p_run_id: claimed.run_id,
        p_user_id: userId,
      });
      expect(staleMark.error).toBeNull();
      expect(staleMark.data).toEqual([]);
      expect(
        (
          await admin
            .from("riot_connections")
            .update({ connection_epoch: connection.connection_epoch })
            .eq("id", connection.id)
        ).error,
      ).toBeNull();

      const marks = await Promise.all(
        Array.from({ length: 8 }, () =>
          admin.rpc("mark_riot_storefront_attempt", {
            p_connection_epoch: connection.connection_epoch,
            p_connection_id: connection.id,
            p_rotation_lease_token: rotationLeaseToken,
            p_run_id: claimed.run_id,
            p_user_id: userId,
          }),
        ),
      );
      expect(marks.filter(({ data, error }) => !error && data?.length === 1)).toHaveLength(1);

      expect((await admin.from("riot_connections").delete().eq("id", connection.id)).error).toBeNull();
      expect(
        (
          await admin
            .from("riot_daily_runs")
            .select("id")
            .eq("id", claimed.run_id)
        ).data,
      ).toEqual([{ id: claimed.run_id }]);

      const { data: replacement } = await admin
        .from("riot_connections")
        .insert({ encrypted_jar: "\\x00", jar_nonce: "\\x00", user_id: userId })
        .select("connection_epoch, id")
        .single();
      expect(replacement).not.toBeNull();
      const replacementArgs = {
        p_connection_epoch: replacement!.connection_epoch,
        p_connection_id: replacement!.id,
        p_user_id: userId,
      };
      const replacementLease = await admin.rpc(
        "claim_riot_session_rotation",
        replacementArgs,
      );
      const replacementLeaseToken = replacementLease.data?.[0]?.lease_token;
      expect(replacementLease.error).toBeNull();
      expect(replacementLeaseToken).toBeTruthy();
      const duplicate = await admin.rpc("claim_riot_daily_run", {
        ...replacementArgs,
        p_rotation_lease_token: replacementLeaseToken!,
      });
      expect(duplicate.error).toBeNull();
      // Reconnecting must not mint a fresh allowance: the run already spent
      // today still counts against the accounts this login currently holds.
      expect(duplicate.data).toEqual([]);

      // A genuinely additional account earns its own run for the same day.
      const { data: second, error: secondError } = await admin
        .from("riot_connections")
        .insert({
          encrypted_jar: "\\x00",
          jar_nonce: "\\x00",
          label: "second account",
          user_id: userId,
        })
        .select("connection_epoch, id")
        .single();
      expect(secondError).toBeNull();
      expect(second).not.toBeNull();
      const secondArgs = {
        p_connection_epoch: second!.connection_epoch,
        p_connection_id: second!.id,
        p_user_id: userId,
      };
      const secondLease = await admin.rpc(
        "claim_riot_session_rotation",
        secondArgs,
      );
      const secondLeaseToken = secondLease.data?.[0]?.lease_token;
      expect(secondLease.error).toBeNull();
      expect(secondLeaseToken).toBeTruthy();
      const secondClaim = await admin.rpc("claim_riot_daily_run", {
        ...secondArgs,
        p_rotation_lease_token: secondLeaseToken!,
      });
      expect(secondClaim.error).toBeNull();
      expect(secondClaim.data).toHaveLength(1);

      // But only one, even across repeated attempts.
      const thirdClaim = await admin.rpc("claim_riot_daily_run", {
        ...secondArgs,
        p_rotation_lease_token: secondLeaseToken!,
      });
      expect(thirdClaim.error).toBeNull();
      expect(thirdClaim.data).toEqual([]);

      expect((await anon.from("riot_daily_runs").select("id")).error).not.toBeNull();
      expect((await anon.rpc("claim_riot_daily_run", args)).error).not.toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  }, 60_000);
});
