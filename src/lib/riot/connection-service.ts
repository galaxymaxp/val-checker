import {
  type CapturedSession,
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
  readonly connectionId?: unknown;
  readonly consentGranted: boolean;
  readonly identity: RiotConnectIdentity;
  readonly label?: unknown;
  readonly region?: unknown;
  readonly session: SubmittedCookieJarInput;
};

export type ConnectCredentialsRequest = {
  readonly connectionId?: unknown;
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

const CONNECTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeConnectionId(connectionId: unknown): string | null {
  if (connectionId === undefined || connectionId === null) {
    return null;
  }
  if (
    typeof connectionId !== "string" ||
    !CONNECTION_ID_PATTERN.test(connectionId)
  ) {
    throw new Error("The Riot connection target is invalid.");
  }
  return connectionId;
}

export interface RiotSessionIdentityResolver {
  resolve(
    session: CapturedSession,
    region: RiotRegion,
  ): Promise<{
    readonly puuid: string;
    readonly session: CapturedSession;
  }>;
}

/**
 * Connection flow. Connecting or reconnecting may contact Riot's auth and
 * user-info hosts to bind the encrypted session to a stable PUUID, but it never
 * fetches a storefront. Storefront reads remain in the shared refresh worker.
 */
export class RiotConnectionService {
  constructor(
    private readonly provider: ManualCookieProvider,
    private readonly store: SessionStore,
    private readonly allowlist: RiotConnectAllowlist,
    private readonly submittedProvider = new SubmittedCookieProvider(),
    private readonly loginProvider?: RiotLoginProvider,
    private readonly pendingAuth?: PendingAuthStore,
    private readonly identityResolver?: RiotSessionIdentityResolver,
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
    const connectionId = normalizeConnectionId(request.connectionId);

    const outcome = await loginProvider.submitCredentials({
      password: request.password,
      username: request.username,
    });

    if (outcome.kind === "multifactor") {
      // Carry region and label forward so the code step saves what was chosen
      // on the first screen.
      await pendingAuth.save(request.identity.userId, outcome.pendingJar, {
        ...(connectionId ? { connectionId } : {}),
        label,
        region,
      });

      return {
        kind: "multifactor",
        maskedTarget: outcome.maskedTarget,
        method: outcome.method,
      };
    }

    const identity = await this.resolveIdentity(outcome.session, region);
    await this.store.save(request.identity.userId, identity.session, {
      ...(connectionId ? { connectionId } : {}),
      label,
      ...(identity.puuid ? { puuid: identity.puuid } : {}),
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
        ...(pending.connectionId
          ? { connectionId: pending.connectionId }
          : {}),
        label: pending.label,
        region: pending.region,
      });

      return {
        kind: "multifactor",
        maskedTarget: outcome.maskedTarget,
        method: outcome.method,
      };
    }

    const region = pending.region ?? parseRiotRegion(undefined);
    const identity = await this.resolveIdentity(outcome.session, region);
    await this.store.save(request.identity.userId, identity.session, {
      ...(pending.connectionId
        ? { connectionId: pending.connectionId }
        : {}),
      label: pending.label,
      ...(identity.puuid ? { puuid: identity.puuid } : {}),
      region,
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

  private async resolveIdentity(
    session: CapturedSession,
    region: RiotRegion,
  ) {
    if (!this.identityResolver) {
      return { puuid: null, session };
    }
    return this.identityResolver.resolve(session, region);
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
    const connectionId = normalizeConnectionId(request.connectionId);
    const resolvedIdentity = await this.resolveIdentity(session, region);
    await this.store.save(request.identity.userId, resolvedIdentity.session, {
      ...(connectionId ? { connectionId } : {}),
      label,
      ...(resolvedIdentity.puuid
        ? { puuid: resolvedIdentity.puuid }
        : {}),
      region,
    });
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
