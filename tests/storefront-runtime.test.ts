import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/src/lib/riot/adapter";
import type { DailyStorefrontWorkerDependencies } from "@/src/lib/worker/storefront-worker";
import {
  buildConfiguredDailyStorefrontWorker,
  StorefrontWorkerConfigurationError,
} from "@/src/lib/worker/storefront-runtime";

const mocks = vi.hoisted(() => ({
  admin: { kind: "admin-client" },
  createAdmin: vi.fn(),
  createDelivery: vi.fn(),
  createTlsTunedFetch: vi.fn(),
  deliver: vi.fn(),
  loadKeyring: vi.fn(),
  repositoryArguments: [] as unknown[][],
  resendConstructor: vi.fn(),
  riotClientArguments: [] as unknown[],
  tunedFetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/notifications/resend-delivery", () => {
  class StorefrontEmailDeliveryError extends Error {}
  class ResendEmailProvider {
    constructor(apiKey: string) {
      mocks.resendConstructor(apiKey);
    }

    send = vi.fn().mockResolvedValue({ id: "email-id" });
  }

  return {
    createStorefrontEmailDeliveryService: mocks.createDelivery,
    ResendEmailProvider,
    StorefrontEmailDeliveryError,
  };
});

vi.mock("@/src/lib/notifications/session-expired", () => ({
  renderSessionExpiredEmail: vi.fn(() => ({ html: "<p>expired</p>", subject: "Expired" })),
}));

vi.mock("@/src/lib/riot/client", () => ({
  RiotClient: class RiotClient {
    constructor(options: unknown) {
      mocks.riotClientArguments.push(options);
    }
  },
}));

vi.mock("@/src/lib/riot/session-crypto", () => ({
  AesGcmSessionCipher: class AesGcmSessionCipher {},
  loadSessionKeyring: mocks.loadKeyring,
}));

vi.mock("@/src/lib/riot/session-store", () => ({
  SupabaseEncryptedSessionStore: class SupabaseEncryptedSessionStore {},
}));

vi.mock("@/src/lib/riot/tls-fetch", () => ({
  createTlsTunedFetch: mocks.createTlsTunedFetch,
}));

vi.mock("@/src/lib/storefront/canonicalize", () => ({
  createStorefrontRefreshSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/storefront/pipeline", () => ({
  planStorefrontNotificationsWithClient: vi.fn(),
}));

vi.mock("@/src/lib/storefront/schema", () => ({
  parseStorefrontPayload: vi.fn(),
}));

vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

vi.mock("@/src/lib/worker/storefront-repository", () => ({
  SupabaseDailyStorefrontRepository: class SupabaseDailyStorefrontRepository {
    constructor(...args: unknown[]) {
      mocks.repositoryArguments.push(args);
    }
  },
}));

const session: Session = {
  capturedAt: "2026-08-17T00:00:00.000Z",
  fixtureOnly: false,
  kind: "captured-session",
  material: new Uint8Array([1]),
  provider: "manual-cookie",
};

function dependenciesOf(worker: object): DailyStorefrontWorkerDependencies {
  return (
    worker as unknown as {
      readonly dependencies: DailyStorefrontWorkerDependencies;
    }
  ).dependencies;
}

function deliveryInput(withEmail: boolean) {
  const skinUuid = "33333333-3333-4333-8333-333333333333";
  return {
    canonicalStorefront: {
      bundle: null,
      expiresAt: "2026-08-18T00:00:00.000Z",
      nightMarket: null,
      offers: [],
      shopHash: "a".repeat(64),
      skinUuids: withEmail ? [skinUuid] : [],
      storeDate: "2026-08-17",
    },
    checkedAt: new Date("2026-08-17T00:05:00.000Z"),
    connectionId: "22222222-2222-4222-8222-222222222222",
    decision: { duplicates: [], toSend: [] },
    emails: withEmail
      ? [{ email: { html: "<p>match</p>", subject: "Match" }, skinUuid }]
      : [],
    matches: [],
    userId: "11111111-1111-4111-8111-111111111111",
  };
}

describe("configured storefront worker runtime", () => {
  beforeEach(() => {
    mocks.createAdmin.mockReset().mockReturnValue(mocks.admin);
    mocks.createDelivery.mockReset().mockReturnValue({ deliver: mocks.deliver });
    mocks.createTlsTunedFetch.mockReset().mockReturnValue(mocks.tunedFetch);
    mocks.deliver.mockReset().mockResolvedValue({ emailsSent: 1, emailsSkipped: 0 });
    mocks.loadKeyring.mockReset().mockReturnValue({ currentVersion: 1, keys: new Map() });
    mocks.repositoryArguments.length = 0;
    mocks.resendConstructor.mockReset();
    mocks.riotClientArguments.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the TLS-tuned transport to each Riot client created by the worker", async () => {
    const worker = await buildConfiguredDailyStorefrontWorker({ trigger: "operator" });
    const dependencies = dependenciesOf(worker);

    dependencies.createRiotClient({ region: "ap", session });
    dependencies.createRiotClient({ region: "na", session });

    expect(mocks.createTlsTunedFetch).toHaveBeenCalledTimes(1);
    expect(mocks.riotClientArguments).toEqual([
      { account: { region: "ap" }, fetchImplementation: mocks.tunedFetch, session },
      { account: { region: "na" }, fetchImplementation: mocks.tunedFetch, session },
    ]);
  });

  it("narrows a manual worker to the exact user and connection pair", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const connectionId = "22222222-2222-4222-8222-222222222222";

    const worker = await buildConfiguredDailyStorefrontWorker({
      connectionId,
      trigger: "manual",
      userId,
    });

    expect(mocks.repositoryArguments).toEqual([[mocks.admin, userId, connectionId]]);
    expect(dependenciesOf(worker).trigger).toBe("manual");
  });

  it("rejects partial or cron targets before constructing privileged dependencies", async () => {
    await expect(
      buildConfiguredDailyStorefrontWorker({ trigger: "manual" }),
    ).rejects.toBeInstanceOf(StorefrontWorkerConfigurationError);
    await expect(
      buildConfiguredDailyStorefrontWorker({ trigger: "manual", userId: "user-only" }),
    ).rejects.toBeInstanceOf(StorefrontWorkerConfigurationError);
    await expect(
      buildConfiguredDailyStorefrontWorker({
        connectionId: "connection",
        trigger: "cron",
        userId: "user",
      }),
    ).rejects.toBeInstanceOf(StorefrontWorkerConfigurationError);
    await expect(
      buildConfiguredDailyStorefrontWorker({
        connectionId: "",
        trigger: "operator",
        userId: "",
      }),
    ).rejects.toBeInstanceOf(StorefrontWorkerConfigurationError);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("does not resolve Resend configuration for construction or a no-email plan", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const worker = await buildConfiguredDailyStorefrontWorker({ trigger: "cron" });
    const dependencies = dependenciesOf(worker);

    await expect(
      dependencies.sendStorefront(deliveryInput(false)),
    ).resolves.toEqual({ emailsSent: 0 });
    expect(mocks.createDelivery).not.toHaveBeenCalled();
    expect(mocks.resendConstructor).not.toHaveBeenCalled();
  });

  it("constructs storefront email delivery only when an email is planned", async () => {
    const worker = await buildConfiguredDailyStorefrontWorker({ trigger: "cron" });
    const dependencies = dependenciesOf(worker);

    await expect(
      dependencies.sendStorefront(deliveryInput(true)),
    ).resolves.toEqual({ emailsSent: 1 });
    expect(mocks.createDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.deliver).toHaveBeenCalledWith({
      canonicalStorefront: deliveryInput(true).canonicalStorefront,
      checkedAt: deliveryInput(true).checkedAt,
      connectionId: deliveryInput(true).connectionId,
      emails: deliveryInput(true).emails,
      userId: deliveryInput(true).userId,
    });
  });
});
