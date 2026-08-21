import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createStorefrontEmailDeliveryService,
  type EmailDeliveryProvider,
  StorefrontEmailDeliveryError,
  StorefrontEmailDeliveryService,
} from "@/src/lib/notifications/resend-delivery";
import type { CanonicalStorefront } from "@/src/lib/storefront/canonicalize";
import type { PlannedStorefrontEmail } from "@/src/lib/storefront/pipeline";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const firstSkinUuid = "33333333-3333-4333-8333-333333333333";
const secondSkinUuid = "44444444-4444-4444-8444-444444444444";
const acceptedAt = new Date("2026-08-14T00:06:00.000Z");

function plannedEmail(skinUuid: string): PlannedStorefrontEmail {
  return {
    email: {
      html: `<p>match ${skinUuid}</p>`,
      subject: `Match ${skinUuid}`,
    },
    skinUuid,
  };
}

function canonicalStorefront(
  skinUuids: readonly string[] = [firstSkinUuid],
): CanonicalStorefront {
  return {
    bundle: null,
    expiresAt: "2026-08-15T00:00:00.000Z",
    nightMarket: null,
    offers: [],
    shopHash: "a".repeat(64),
    skinUuids,
    storeDate: "2026-08-14",
  };
}

type Reservation = {
  readonly notification_delivery_claimed: boolean;
  readonly notification_emailed_at: string | null;
  readonly notification_id: string;
  readonly shop_check_id: string;
};

function deliveryClient(options: {
  readonly confirmed?: boolean;
  readonly markError?: unknown;
  readonly reservations?: readonly Reservation[];
} = {}) {
  const reservations = options.reservations ?? [
    {
      notification_delivery_claimed: true,
      notification_emailed_at: null,
      notification_id: "55555555-5555-4555-8555-555555555555",
      shop_check_id: "66666666-6666-4666-8666-666666666666",
    },
  ];
  let reservationIndex = 0;
  const getUserById = vi.fn().mockResolvedValue({
    data: {
      user: {
        email: "verified@example.com",
        email_confirmed_at:
          options.confirmed === false ? null : "2026-08-13T00:00:00.000Z",
      },
    },
    error: null,
  });
  const rpc = vi.fn(async () => ({
    data: [
      reservations[Math.min(reservationIndex++, reservations.length - 1)],
    ],
    error: null,
  }));
  const single = vi.fn(async () => ({
    data: options.markError ? null : { id: "notification-id" },
    error: options.markError ?? null,
  }));
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn();
  const updateQuery = { eq, select };
  eq.mockReturnValue(updateQuery);
  const update = vi.fn(() => updateQuery);
  const from = vi.fn((table: string) => {
    if (table !== "notifications") {
      throw new Error(`Unexpected test table: ${table}`);
    }
    return { update };
  });

  return {
    client: {
      auth: { admin: { getUserById } },
      from,
      rpc,
    } as unknown as SupabaseClient<Database>,
    eq,
    from,
    getUserById,
    rpc,
    single,
    update,
  };
}

function provider() {
  const send = vi.fn().mockResolvedValue({ id: "resend-email-id" });
  return { provider: { send } as EmailDeliveryProvider, send };
}

function input(
  emails: readonly PlannedStorefrontEmail[] = [plannedEmail(firstSkinUuid)],
  storefront = canonicalStorefront(emails.map(({ skinUuid }) => skinUuid)),
) {
  return {
    canonicalStorefront: storefront,
    checkedAt: new Date("2026-08-14T00:05:00.000Z"),
    connectionId,
    emails,
    userId,
  };
}

describe("storefront Resend delivery", () => {
  it("sends to the verified auth email and marks each acceptance afterward", async () => {
    const reservations: Reservation[] = [firstSkinUuid, secondSkinUuid].map(
      (_skinUuid, ordinal) => ({
        notification_delivery_claimed: true,
        notification_emailed_at: null,
        notification_id: `${ordinal + 5}5555555-5555-4555-8555-555555555555`,
        shop_check_id: "66666666-6666-4666-8666-666666666666",
      }),
    );
    const { client, getUserById, rpc, update } = deliveryClient({
      reservations,
    });
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
      now: () => acceptedAt,
    });
    const emails = [plannedEmail(firstSkinUuid), plannedEmail(secondSkinUuid)];

    await expect(service.deliver(input(emails))).resolves.toEqual({
      emailsSent: 2,
      emailsSkipped: 0,
    });
    expect(getUserById).toHaveBeenCalledWith(userId);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual([
      "reserve_storefront_notification",
      {
        p_checked_at: "2026-08-14T00:05:00.000Z",
        p_connection_id: connectionId,
        p_expires_at: "2026-08-15T00:00:00.000Z",
        p_offer_skin_uuids: [firstSkinUuid, secondSkinUuid],
        p_rotation_date: "2026-08-14",
        p_shop_hash: "a".repeat(64),
        p_skin_uuid: firstSkinUuid,
        p_user_id: userId,
      },
    ]);
    expect(send.mock.calls).toEqual([
      [
        {
          from: "VAL Checker <alerts@example.com>",
          html: `<p>match ${firstSkinUuid}</p>`,
          idempotencyKey: `val-checker/storefront-match/${reservations[0].notification_id}`,
          subject: `Match ${firstSkinUuid}`,
          to: "verified@example.com",
        },
      ],
      [
        {
          from: "VAL Checker <alerts@example.com>",
          html: `<p>match ${secondSkinUuid}</p>`,
          idempotencyKey: `val-checker/storefront-match/${reservations[1].notification_id}`,
          subject: `Match ${secondSkinUuid}`,
          to: "verified@example.com",
        },
      ],
    ]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      emailed_at: acceptedAt.toISOString(),
    });
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
    expect(send.mock.invocationCallOrder[1]).toBeLessThan(
      update.mock.invocationCallOrder[1],
    );
  });

  it("skips an atomically reserved notification that is already emailed", async () => {
    const { client, from } = deliveryClient({
      reservations: [
        {
          notification_delivery_claimed: false,
          notification_emailed_at: "2026-08-14T00:06:00.000Z",
          notification_id: "55555555-5555-4555-8555-555555555555",
          shop_check_id: "66666666-6666-4666-8666-666666666666",
        },
      ],
    });
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
    });

    await expect(service.deliver(input())).resolves.toEqual({
      emailsSent: 0,
      emailsSkipped: 1,
    });
    expect(send).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the same provider key on retry and stops after emailed_at is present", async () => {
    const notificationId = "55555555-5555-4555-8555-555555555555";
    const { client } = deliveryClient({
      reservations: [
        {
          notification_delivery_claimed: true,
          notification_emailed_at: null,
          notification_id: notificationId,
          shop_check_id: "66666666-6666-4666-8666-666666666666",
        },
        {
          notification_delivery_claimed: false,
          notification_emailed_at: acceptedAt.toISOString(),
          notification_id: notificationId,
          shop_check_id: "66666666-6666-4666-8666-666666666666",
        },
      ],
    });
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
      now: () => acceptedAt,
    });

    await service.deliver(input());
    await expect(service.deliver(input())).resolves.toEqual({
      emailsSent: 0,
      emailsSkipped: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].idempotencyKey).toBe(
      `val-checker/storefront-match/${notificationId}`,
    );
  });

  it("does not mark a notification when the provider rejects it", async () => {
    const { client, from } = deliveryClient();
    const send = vi
      .fn()
      .mockRejectedValue(new Error("provider leaked re_sensitive_key"));
    const service = new StorefrontEmailDeliveryService(
      client,
      { send },
      { from: "VAL Checker <alerts@example.com>" },
    );

    await expect(service.deliver(input())).rejects.toEqual(
      new StorefrontEmailDeliveryError(),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("treats an accepted email whose marker fails as a delivery failure", async () => {
    const { client, update } = deliveryClient({
      markError: new Error("sensitive database detail"),
    });
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
      now: () => acceptedAt,
    });

    await expect(service.deliver(input())).rejects.toEqual(
      new StorefrontEmailDeliveryError(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
  });

  it("rejects an unverified auth recipient before reserving or sending", async () => {
    const { client, rpc } = deliveryClient({ confirmed: false });
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
    });

    await expect(service.deliver(input())).rejects.toEqual(
      new StorefrontEmailDeliveryError(),
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does no auth, database, or provider work for an empty plan", async () => {
    const { client, getUserById, rpc } = deliveryClient();
    const { provider: emailProvider, send } = provider();
    const service = new StorefrontEmailDeliveryService(client, emailProvider, {
      from: "VAL Checker <alerts@example.com>",
    });

    await expect(
      service.deliver(input([], canonicalStorefront([]))),
    ).resolves.toEqual({ emailsSent: 0, emailsSkipped: 0 });
    expect(getUserById).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed for missing Resend configuration or header injection", () => {
    const { client } = deliveryClient();

    expect(() => createStorefrontEmailDeliveryService(client, {})).toThrow(
      StorefrontEmailDeliveryError,
    );
    expect(
      () =>
        new StorefrontEmailDeliveryService(client, provider().provider, {
          from: "alerts@example.com\r\nBcc: attacker@example.com",
        }),
    ).toThrow(StorefrontEmailDeliveryError);
  });
});
