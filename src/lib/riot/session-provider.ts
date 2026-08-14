import { z } from "zod";

export type CapturedSession = {
  readonly capturedAt: string;
  readonly fixtureOnly: boolean;
  readonly kind: "captured-session";
  readonly material: Uint8Array;
  readonly provider: "manual-cookie";
};

export type ManualCookieFixtureInput = {
  readonly fixtureOnly: true;
  readonly serializedJar: Uint8Array;
};

export type SubmittedCookieJarInput = {
  readonly serializedJar: string;
};

export const MAX_SUBMITTED_COOKIE_JAR_BYTES = 128 * 1024;

const browserCookieSchema = z
  .object({
    domain: z.string().min(1),
    expirationDate: z.number().finite().optional(),
    expires: z.number().finite().optional(),
    hostOnly: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    name: z.string().min(1),
    path: z.string().optional(),
    sameSite: z.string().optional(),
    secure: z.boolean().optional(),
    value: z.string(),
  })
  .loose();

const diagnosticCookieSchema = z
  .object({
    "Content raw": z.string(),
    "Expires raw": z.string().optional(),
    "Host raw": z.string().min(1),
    "Name raw": z.string().min(1),
    "Path raw": z.string().optional(),
  })
  .loose();

const submittedCookieJarSchema = z
  .array(z.union([browserCookieSchema, diagnosticCookieSchema]))
  .min(1)
  .max(256);

export interface SessionProvider<Input> {
  readonly kind: string;
  capture(input: Input): Promise<CapturedSession>;
}

export class FixtureSessionInputError extends Error {
  constructor() {
    super("Manual cookie fixture session material is required.");
    this.name = "FixtureSessionInputError";
  }
}

export class SubmittedSessionInputError extends Error {
  constructor() {
    super("A valid exported Riot cookie jar is required.");
    this.name = "SubmittedSessionInputError";
  }
}

type ManualCookieProviderOptions = {
  readonly now?: () => Date;
};

/**
 * Fixture-only Phase 5 provider. It performs no file reads or network requests and
 * accepts no browser/request input; callers must inject an already-scrubbed test
 * value explicitly.
 */
export class ManualCookieProvider
  implements SessionProvider<ManualCookieFixtureInput>
{
  readonly kind = "manual-cookie" as const;
  private readonly now: () => Date;

  constructor(options: ManualCookieProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async capture(input: ManualCookieFixtureInput): Promise<CapturedSession> {
    if (
      input.fixtureOnly !== true ||
      !(input.serializedJar instanceof Uint8Array) ||
      input.serializedJar.byteLength === 0
    ) {
      throw new FixtureSessionInputError();
    }

    return {
      capturedAt: this.now().toISOString(),
      fixtureOnly: true,
      kind: "captured-session",
      material: new Uint8Array(input.serializedJar),
      provider: this.kind,
    };
  }
}

type SubmittedCookieProviderOptions = {
  readonly now?: () => Date;
};

/**
 * Offline boundary for a user-submitted cookie export. It validates and copies
 * the jar but deliberately performs no Riot request; live use begins in cron.
 */
export class SubmittedCookieProvider
  implements SessionProvider<SubmittedCookieJarInput>
{
  readonly kind = "manual-cookie" as const;
  private readonly now: () => Date;

  constructor(options: SubmittedCookieProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async capture(input: SubmittedCookieJarInput): Promise<CapturedSession> {
    if (typeof input.serializedJar !== "string") {
      throw new SubmittedSessionInputError();
    }

    const material = new TextEncoder().encode(input.serializedJar);
    if (
      material.byteLength === 0 ||
      material.byteLength > MAX_SUBMITTED_COOKIE_JAR_BYTES
    ) {
      throw new SubmittedSessionInputError();
    }

    try {
      const parsed: unknown = JSON.parse(input.serializedJar);
      if (!submittedCookieJarSchema.safeParse(parsed).success) {
        throw new SubmittedSessionInputError();
      }
    } catch (error) {
      if (error instanceof SubmittedSessionInputError) {
        throw error;
      }

      throw new SubmittedSessionInputError();
    }

    return {
      capturedAt: this.now().toISOString(),
      fixtureOnly: false,
      kind: "captured-session",
      material,
      provider: this.kind,
    };
  }
}

export const QR_SESSION_PROVIDER = Object.freeze({
  kind: "qr" as const,
  reason: "QR authentication is not supported in the Phase 5 foundation.",
  status: "not-supported" as const,
});
