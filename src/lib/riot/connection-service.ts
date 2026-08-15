import {
  type ManualCookieFixtureInput,
  ManualCookieProvider,
  type SubmittedCookieJarInput,
  SubmittedCookieProvider,
} from "@/src/lib/riot/session-provider";
import {
  type RiotConnectIdentity,
  RiotConnectAllowlist,
} from "@/src/lib/riot/connect-allowlist";
import {
  parseRiotRegion,
  type RiotRegion,
} from "@/src/lib/riot/account-config";
import type { SessionStore } from "@/src/lib/riot/session-store";
import type { PendingAuthStore } from "@/src/lib/riot/pending-auth-store";
import {
  RiotLoginError,
  type RiotLoginProvider,
} from "@/src/lib/riot/login-provider";
import type { RiotConnectionState } from "@/src/types/riot-connection";

export class RiotConsentRequiredError extends Error {
  constructor() {
    super("Riot session storage requires explicit consent.");
    this.name = "RiotConsentRequiredError";
  }
}

export class RiotCredentialConnectUnavailableError extends Error {
  constructor() {
    super("Credential connect is not configured.");
    this.name = "RiotCredentialConnectUnavailableError";
  }
}

export class RiotPendingAuthExpiredError extends Error {
  constructor() {
    super("The Riot sign-in attempt expired. Please start again.");
    this.name = "RiotPendingAuthExpiredError";
  }
}

type ConnectFixtureRequest = {
  readonly consentGranted: boolean;
  readonly fixture: ManualCookieFixtureInput;
  readonly identity: RiotConnectIdentity;
};

export type ConnectSubmittedSessionRequest = {
  readonly consentGranted: boolean;
  readonly identity: RiotConnectIdentity;
  readonly label?: unknown;
  readonly region?: unknown;
  readonly session: SubmittedCookieJarInput;
};

export type ConnectCredentialsRequest = {
  readonly consentGranted: boolean;
  readonly identity: RiotConnectIdentity;
  readonly label?: unknown;
  /** Transit-only. Forwarded to the login provider and never retained. */
  readonly password: string;
  readonly region?: unknown;
  readonly username: string;
};

export type SubmitMfaCodeRequest = {
  readonly code: string;
  readonly identity: RiotConnectIdentity;
};

export type CredentialConnectResult =
  | { readonly kind: "connected"; readonly state: RiotConnectionState }
  | {
      readonly kind: "multifactor";
      readonly maskedTarget: string | null;
      readonly method: string | null;
    };

function normalizeLabel(label: unknown): string | null {
  return typeof label === "string" && label.trim().length > 0
    ? label.trim().slice(0, 60)
    : null;
}

/**
 * Connection flow. The daily worker remains the only path that reads a
 * storefront; the credential exchange added in Version 2.4 talks to Riot's auth
 * host only, and never fetches a shop.
 */
export class RiotConnectionService {
  constructor(
    private readonly provider: ManualCookieProvider,
    private readonly store: SessionStore,
    private readonly allowlist: RiotConnectAllowlist,
    private readonly submittedProvider = new SubmittedCookieProvider(),
    private readonly loginProvider?: RiotLoginProvider,
    private readonly pendingAuth?: PendingAuthStore,
  ) {}

  /**
   * Step one of credential connect. `request.password` is passed straight to
   * the login provider and is not read, copied, or stored anywhere here.
   */
  async connectWithCredentials(
    request: ConnectCredentialsRequest,
  ): Promise<CredentialConnectResult> {
    this.allowlist.assertAllowed(request.identity);

    if (!request.consentGranted) {
      throw new RiotConsentRequiredError();
    }

    const { loginProvider, pendingAuth } = this.requireCredentialSupport();
    const region: RiotRegion = parseRiotRegion(request.region);
    const label = normalizeLabel(request.label);

    const outcome = await loginProvider.submitCredentials({
      password: request.password,
      username: request.username,
    });

    if (outcome.kind === "multifactor") {
      // Carry region and label forward so the code step saves what was chosen
      // on the first screen.
      await pendingAuth.save(request.identity.userId, outcome.pendingJar, {
        label,
        region,
      });

      return {
        kind: "multifactor",
        maskedTarget: outcome.maskedTarget,
        method: outcome.method,
      };
    }

    await this.store.save(request.identity.userId, outcome.session, {
      label,
      region,
    });
    await pendingAuth.clear(request.identity.userId);
    return { kind: "connected", state: "connected" };
  }

  /** Step two. Consent was already recorded when the challenge was issued. */
  async submitMfaCode(
    request: SubmitMfaCodeRequest,
  ): Promise<CredentialConnectResult> {
    this.allowlist.assertAllowed(request.identity);

    const { loginProvider, pendingAuth } = this.requireCredentialSupport();
    const pending = await pendingAuth.load(request.identity.userId);

    if (!pending) {
      throw new RiotPendingAuthExpiredError();
    }

    let outcome;
    try {
      outcome = await loginProvider.submitMfaCode({
        code: request.code,
        pendingJar: pending.pendingJar,
      });
    } catch (error) {
      // A wrong code leaves the challenge open so the user can retry; anything
      // else invalidates it and sends them back to the credential screen.
      if (
        error instanceof RiotLoginError &&
        error.failure === "invalid-mfa-code"
      ) {
        throw error;
      }

      await pendingAuth.clear(request.identity.userId);
      throw error;
    }

    if (outcome.kind === "multifactor") {
      await pendingAuth.save(request.identity.userId, outcome.pendingJar, {
        label: pending.label,
        region: pending.region,
      });

      return {
        kind: "multifactor",
        maskedTarget: outcome.maskedTarget,
        method: outcome.method,
      };
    }

    await this.store.save(request.identity.userId, outcome.session, {
      label: pending.label,
      region: pending.region ?? parseRiotRegion(undefined),
    });
    await pendingAuth.clear(request.identity.userId);
    return { kind: "connected", state: "connected" };
  }

  private requireCredentialSupport(): {
    loginProvider: RiotLoginProvider;
    pendingAuth: PendingAuthStore;
  } {
    if (!this.loginProvider || !this.pendingAuth) {
      throw new RiotCredentialConnectUnavailableError();
    }

    return { loginProvider: this.loginProvider, pendingAuth: this.pendingAuth };
  }

  async connect(
    request: ConnectSubmittedSessionRequest,
  ): Promise<RiotConnectionState> {
    this.allowlist.assertAllowed(request.identity);

    if (!request.consentGranted) {
      throw new RiotConsentRequiredError();
    }

    const region: RiotRegion = parseRiotRegion(request.region);
    const session = await this.submittedProvider.capture(request.session);
    const label = normalizeLabel(request.label);
    await this.store.save(request.identity.userId, session, { label, region });
    return "connected";
  }

  async connectFixture(
    request: ConnectFixtureRequest,
  ): Promise<RiotConnectionState> {
    this.allowlist.assertAllowed(request.identity);

    if (!request.consentGranted) {
      throw new RiotConsentRequiredError();
    }

    const session = await this.provider.capture(request.fixture);
    await this.store.save(request.identity.userId, session);
    return "connected";
  }

  async disconnect(
    userId: string,
    connectionId: string,
  ): Promise<RiotConnectionState> {
    await this.store.delete(userId, connectionId);
    return "disconnected";
  }
}
