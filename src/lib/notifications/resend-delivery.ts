import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

import type { CanonicalStorefront } from "@/src/lib/storefront/canonicalize";
import type { PlannedStorefrontEmail } from "@/src/lib/storefront/pipeline";
import type { Database } from "@/src/types/database";

const IDEMPOTENCY_PREFIX = "val-checker/storefront-match/";

export class StorefrontEmailDeliveryError extends Error {
  constructor() {
    super("Storefront notification delivery failed.");
    this.name = "StorefrontEmailDeliveryError";
  }
}

export interface EmailProviderMessage {
  readonly from: string;
  readonly html: string;
  readonly idempotencyKey: string;
  readonly subject: string;
  readonly to: string;
}

export interface EmailProviderAcceptance {
  readonly id: string;
}

export interface EmailDeliveryProvider {
  send(message: EmailProviderMessage): Promise<EmailProviderAcceptance>;
}

export class ResendEmailProvider implements EmailDeliveryProvider {
  private readonly resend: Resend;

  constructor(apiKey: string) {
    if (apiKey.trim().length === 0) {
      throw new StorefrontEmailDeliveryError();
    }
    this.resend = new Resend(apiKey);
  }

  async send(message: EmailProviderMessage): Promise<EmailProviderAcceptance> {
    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: message.from,
          html: message.html,
          subject: message.subject,
          to: message.to,
        },
        { idempotencyKey: message.idempotencyKey },
      );

      if (error || !data?.id) {
        throw new StorefrontEmailDeliveryError();
      }

      return { id: data.id };
    } catch {
      throw new StorefrontEmailDeliveryError();
    }
  }
}

export interface StorefrontEmailDeliveryInput {
  readonly canonicalStorefront: CanonicalStorefront;
  readonly checkedAt: Date;
  readonly connectionId: string;
  readonly emails: readonly PlannedStorefrontEmail[];
  readonly userId: string;
}

export interface StorefrontEmailDeliveryResult {
  readonly emailsSent: number;
  readonly emailsSkipped: number;
}

export interface StorefrontEmailDeliveryOptions {
  readonly from: string;
  readonly now?: () => Date;
}

export class StorefrontEmailDeliveryService {
  private readonly from: string;
  private readonly now: () => Date;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly provider: EmailDeliveryProvider,
    options: StorefrontEmailDeliveryOptions,
  ) {
    if (options.from.trim().length === 0 || /[\r\n]/.test(options.from)) {
      throw new StorefrontEmailDeliveryError();
    }
    this.from = options.from;
    this.now = options.now ?? (() => new Date());
  }

  async deliver(
    input: StorefrontEmailDeliveryInput,
  ): Promise<StorefrontEmailDeliveryResult> {
    if (input.emails.length === 0) {
      return { emailsSent: 0, emailsSkipped: 0 };
    }

    const checkedAt = this.checkedAt(input);
    const recipient = await this.loadVerifiedEmail(input.userId);
    let emailsSent = 0;
    let emailsSkipped = 0;

    for (const planned of input.emails) {
      if (!input.canonicalStorefront.skinUuids.includes(planned.skinUuid)) {
        throw new StorefrontEmailDeliveryError();
      }

      const reservation = await this.reserve(input, planned.skinUuid, checkedAt);
      if (!reservation.notification_delivery_claimed) {
        emailsSkipped += 1;
        continue;
      }

      try {
        await this.provider.send({
          from: this.from,
          html: planned.email.html,
          idempotencyKey: `${IDEMPOTENCY_PREFIX}${reservation.notification_id}`,
          subject: planned.email.subject,
          to: recipient,
        });
      } catch {
        throw new StorefrontEmailDeliveryError();
      }
      await this.markAccepted(
        reservation.notification_id,
        input.userId,
        this.now(),
      );
      emailsSent += 1;
    }

    return { emailsSent, emailsSkipped };
  }

  private checkedAt(input: StorefrontEmailDeliveryInput): string {
    const checkedAtMs = input.checkedAt.getTime();
    if (!Number.isFinite(checkedAtMs)) {
      throw new StorefrontEmailDeliveryError();
    }

    const checkedAt = input.checkedAt.toISOString();
    if (checkedAt.slice(0, 10) !== input.canonicalStorefront.storeDate) {
      throw new StorefrontEmailDeliveryError();
    }
    return checkedAt;
  }

  private async loadVerifiedEmail(userId: string): Promise<string> {
    try {
      const { data, error } = await this.supabase.auth.admin.getUserById(userId);
      const email = data.user?.email?.trim();
      if (error || !email || !data.user?.email_confirmed_at) {
        throw new StorefrontEmailDeliveryError();
      }
      return email;
    } catch {
      throw new StorefrontEmailDeliveryError();
    }
  }

  private async reserve(
    input: StorefrontEmailDeliveryInput,
    skinUuid: string,
    checkedAt: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      "reserve_storefront_notification",
      {
        p_checked_at: checkedAt,
        p_connection_id: input.connectionId,
        p_expires_at: input.canonicalStorefront.expiresAt,
        p_offer_skin_uuids: [...input.canonicalStorefront.skinUuids],
        p_rotation_date: input.canonicalStorefront.storeDate,
        p_shop_hash: input.canonicalStorefront.shopHash,
        p_skin_uuid: skinUuid,
        p_user_id: input.userId,
      },
    );
    const reservation = data?.[0];
    if (error || !reservation?.notification_id) {
      throw new StorefrontEmailDeliveryError();
    }
    return reservation;
  }

  private async markAccepted(
    notificationId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<void> {
    if (!Number.isFinite(acceptedAt.getTime())) {
      throw new StorefrontEmailDeliveryError();
    }

    const { data, error } = await this.supabase
      .from("notifications")
      .update({ emailed_at: acceptedAt.toISOString() })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .select("id")
      .single();

    if (error || !data) {
      throw new StorefrontEmailDeliveryError();
    }
  }
}

export type ResendEnvironment = {
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM_EMAIL?: string;
};

export function createStorefrontEmailDeliveryService(
  supabase: SupabaseClient<Database>,
  environment: ResendEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  },
): StorefrontEmailDeliveryService {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    throw new StorefrontEmailDeliveryError();
  }

  return new StorefrontEmailDeliveryService(
    supabase,
    new ResendEmailProvider(apiKey),
    { from },
  );
}
