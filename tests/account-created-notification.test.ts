import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AccountCreationNotificationService,
  createAccountCreationNotificationService,
} from "@/src/lib/notifications/account-created";
import type { EmailDeliveryProvider } from "@/src/lib/notifications/resend-delivery";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

const userId = "11111111-1111-4111-8111-111111111111";
const signupAt = "2026-08-23T01:30:00.000Z";
const emailedAt = new Date("2026-08-23T01:31:00.000Z");

function notificationClient(claims: ReadonlyArray<string | null>) {
  let claimIndex = 0;
  const rpc = vi.fn(async () => {
    const claimedAt = claims[Math.min(claimIndex++, claims.length - 1)];
    return {
      data: claimedAt ? [{ signup_at: claimedAt }] : [],
      error: null,
    };
  });
  const single = vi.fn(async () => ({ data: { user_id: userId }, error: null }));
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));

  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    rpc,
    update,
  };
}

function provider() {
  const send = vi.fn().mockResolvedValue({ id: "resend-email-id" });
  return { provider: { send } as EmailDeliveryProvider, send };
}

describe("new-account owner notification", () => {
  it("fires once for a brand-new account and includes only its signup timestamp", async () => {
    const { client, rpc, update } = notificationClient([signupAt]);
    const { provider: emailProvider, send } = provider();
    const service = new AccountCreationNotificationService(
      client,
      emailProvider,
      {
        from: "VAL Checker <alerts@example.com>",
        now: () => emailedAt,
        ownerEmail: "owner@example.com",
      },
    );

    await expect(service.deliver(userId)).resolves.toBe("sent");

    expect(rpc).toHaveBeenCalledWith("claim_account_creation_notification", {
      p_user_id: userId,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      from: "VAL Checker <alerts@example.com>",
      html:
        '<!doctype html><html lang="en"><body><p>A new VAL Checker account was created.</p><p>Signup timestamp: 2026-08-23T01:30:00.000Z</p></body></html>',
      idempotencyKey: `val-checker/account-created/${userId}`,
      subject: "New VAL Checker account created",
      to: "owner@example.com",
    });
    expect(update).toHaveBeenCalledWith({ emailed_at: emailedAt.toISOString() });
  });

  it("does not fire another notification for a returning login", async () => {
    const { client } = notificationClient([signupAt, null]);
    const { provider: emailProvider, send } = provider();
    const service = new AccountCreationNotificationService(
      client,
      emailProvider,
      {
        from: "VAL Checker <alerts@example.com>",
        ownerEmail: "owner@example.com",
      },
    );

    await expect(service.deliver(userId)).resolves.toBe("sent");
    await expect(service.deliver(userId)).resolves.toBe("skipped");
    expect(send).toHaveBeenCalledOnce();
  });

  it("requires the owner recipient without restricting account signup", () => {
    const { client } = notificationClient([signupAt]);

    expect(() =>
      createAccountCreationNotificationService(client, {
        RESEND_API_KEY: "resend-key",
        RESEND_FROM_EMAIL: "alerts@example.com",
      }),
    ).toThrow("Account creation notification delivery failed.");
  });
});
