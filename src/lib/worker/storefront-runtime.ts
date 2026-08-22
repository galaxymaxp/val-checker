import "server-only";

import {
  createStorefrontEmailDeliveryService,
  ResendEmailProvider,
  StorefrontEmailDeliveryError,
} from "@/src/lib/notifications/resend-delivery";
import { renderSessionExpiredEmail } from "@/src/lib/notifications/session-expired";
import { RiotClient } from "@/src/lib/riot/client";
import {
  AesGcmSessionCipher,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createTlsTunedFetch } from "@/src/lib/riot/tls-fetch";
import { createStorefrontRefreshSnapshot } from "@/src/lib/storefront/canonicalize";
import { planStorefrontNotificationsWithClient } from "@/src/lib/storefront/pipeline";
import { parseStorefrontPayload } from "@/src/lib/storefront/schema";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { SupabaseDailyStorefrontRepository } from "@/src/lib/worker/storefront-repository";
import {
  DailyStorefrontWorker,
  type StorefrontRefreshTrigger,
} from "@/src/lib/worker/storefront-worker";

export type ConfiguredStorefrontWorkerOptions = {
  readonly connectionId?: string;
  readonly trigger?: StorefrontRefreshTrigger;
  readonly userId?: string;
};

export class StorefrontWorkerConfigurationError extends Error {
  constructor() {
    super("The storefront worker target is invalid.");
    this.name = "StorefrontWorkerConfigurationError";
  }
}

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateOptions(options: ConfiguredStorefrontWorkerOptions) {
  const trigger = options.trigger ?? "cron";
  const hasUser = options.userId !== undefined;
  const hasConnection = options.connectionId !== undefined;

  if (
    (trigger !== "cron" && trigger !== "manual" && trigger !== "operator") ||
    (trigger === "cron" && (hasUser || hasConnection))
  ) {
    throw new StorefrontWorkerConfigurationError();
  }
  if (hasUser !== hasConnection) {
    throw new StorefrontWorkerConfigurationError();
  }
  if (
    hasUser &&
    hasConnection &&
    (!DATABASE_UUID_PATTERN.test(options.userId!) ||
      !DATABASE_UUID_PATTERN.test(options.connectionId!))
  ) {
    throw new StorefrontWorkerConfigurationError();
  }
  if (trigger === "manual" && (!hasUser || !hasConnection)) {
    throw new StorefrontWorkerConfigurationError();
  }

  return { connectionId: options.connectionId, trigger, userId: options.userId };
}

/**
 * Builds one refresh pipeline for automatic, manual, and future operator runs.
 * Manual work is always narrowed to one exact owned connection. Cron is never
 * targetable; a future internal operator caller may optionally target one.
 */
export async function buildConfiguredDailyStorefrontWorker(
  options: ConfiguredStorefrontWorkerOptions = {},
): Promise<DailyStorefrontWorker> {
  const configured = validateOptions(options);
  const supabase = createAdminSupabaseClient();
  const sessionStore = new SupabaseEncryptedSessionStore(
    supabase,
    new AesGcmSessionCipher(loadSessionKeyring()),
  );
  const repository = new SupabaseDailyStorefrontRepository(
    supabase,
    configured.userId,
    configured.connectionId,
  );
  const riotFetch = createTlsTunedFetch();

  return new DailyStorefrontWorker({
    createRiotClient: ({ region, session }) =>
      new RiotClient({
        account: { region },
        fetchImplementation: riotFetch,
        session,
      }),
    pipeline: (input) => planStorefrontNotificationsWithClient(supabase, input),
    prepareStorefront: async ({ checkedAt, storefront }) =>
      createStorefrontRefreshSnapshot(
        parseStorefrontPayload(storefront.payload),
        checkedAt,
      ),
    repository,
    sendExpiry: async ({ email, idempotencyKey }) => {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.RESEND_FROM_EMAIL?.trim();
      if (!apiKey || !from) {
        throw new StorefrontEmailDeliveryError();
      }
      const expiryProvider = new ResendEmailProvider(apiKey);
      const rendered = renderSessionExpiredEmail({
        connection: "disconnected",
        reason: "session-expired",
      });
      if (!rendered) {
        throw new StorefrontEmailDeliveryError();
      }
      await expiryProvider.send({
        from,
        html: rendered.html,
        idempotencyKey,
        subject: rendered.subject,
        to: email,
      });
    },
    sendStorefront: async (input) => {
      if (input.emails.length === 0) {
        return { emailsSent: 0 };
      }
      // Email configuration is intentionally resolved only after the valid
      // storefront has been persisted. A missing provider cannot erase a
      // no-match result or block the rest of the worker at construction time.
      const storefrontDelivery = createStorefrontEmailDeliveryService(supabase);
      const { emailsSent } = await storefrontDelivery.deliver({
        canonicalStorefront: input.canonicalStorefront,
        checkedAt: input.checkedAt,
        connectionId: input.connectionId,
        emails: input.emails,
        userId: input.userId,
      });
      return { emailsSent };
    },
    sessionStore,
    trigger: configured.trigger,
  });
}

export async function runConfiguredDailyStorefrontCron() {
  const worker = await buildConfiguredDailyStorefrontWorker({ trigger: "cron" });
  return worker.run();
}
