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
import type { RiotConnectionState } from "@/src/types/riot-connection";

export class RiotConsentRequiredError extends Error {
  constructor() {
    super("Riot session storage requires explicit consent.");
    this.name = "RiotConsentRequiredError";
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
  readonly region?: unknown;
  readonly session: SubmittedCookieJarInput;
};

/** Offline connection flow. Live Riot access remains exclusive to the daily worker. */
export class RiotConnectionService {
  constructor(
    private readonly provider: ManualCookieProvider,
    private readonly store: SessionStore,
    private readonly allowlist: RiotConnectAllowlist,
    private readonly submittedProvider = new SubmittedCookieProvider(),
  ) {}

  async connect(
    request: ConnectSubmittedSessionRequest,
  ): Promise<RiotConnectionState> {
    this.allowlist.assertAllowed(request.identity);

    if (!request.consentGranted) {
      throw new RiotConsentRequiredError();
    }

    const region: RiotRegion = parseRiotRegion(request.region);
    const session = await this.submittedProvider.capture(request.session);
    await this.store.save(request.identity.userId, session, { region });
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

  async disconnect(userId: string): Promise<RiotConnectionState> {
    await this.store.delete(userId);
    return "disconnected";
  }
}
