export type CapturedSession = {
  readonly capturedAt: string;
  readonly fixtureOnly: true;
  readonly kind: "captured-session";
  readonly material: Uint8Array;
  readonly provider: "manual-cookie";
};

export type ManualCookieFixtureInput = {
  readonly fixtureOnly: true;
  readonly serializedJar: Uint8Array;
};

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

export const QR_SESSION_PROVIDER = Object.freeze({
  kind: "qr" as const,
  reason: "QR authentication is not supported in the Phase 5 foundation.",
  status: "not-supported" as const,
});
