import {
  type ManualCookieFixtureInput,
  ManualCookieProvider,
} from "@/src/lib/riot/session-provider";
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
  readonly userId: string;
};

/** Fixture-only application flow. No request or browser input reaches this class. */
export class RiotConnectionService {
  constructor(
    private readonly provider: ManualCookieProvider,
    private readonly store: SessionStore,
  ) {}

  async connectFixture(
    request: ConnectFixtureRequest,
  ): Promise<RiotConnectionState> {
    if (!request.consentGranted) {
      throw new RiotConsentRequiredError();
    }

    const session = await this.provider.capture(request.fixture);
    await this.store.save(request.userId, session);
    return "connected";
  }

  async disconnect(userId: string): Promise<RiotConnectionState> {
    await this.store.delete(userId);
    return "disconnected";
  }
}
