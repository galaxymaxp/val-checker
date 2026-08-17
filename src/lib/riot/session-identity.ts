import "server-only";

import type { RiotRegion } from "@/src/lib/riot/account-config";
import { RiotClient, type RiotId } from "@/src/lib/riot/client";
import type { RiotSessionIdentityResolver } from "@/src/lib/riot/connection-service";
import type { CapturedSession } from "@/src/lib/riot/session-provider";

/** Resolves the stable Riot identity before any live session row is stored. */
export class LiveRiotSessionIdentityResolver
  implements RiotSessionIdentityResolver
{
  constructor(private readonly fetchImplementation: typeof fetch) {}

  async resolve(
    session: CapturedSession,
    region: RiotRegion,
  ): Promise<{
    readonly puuid: string;
    readonly riotId: RiotId | null;
    readonly session: CapturedSession;
  }> {
    const client = new RiotClient({
      account: { region },
      fetchImplementation: this.fetchImplementation,
      session,
    });
    const rotated = await client.refreshSession(session);
    const puuid = await client.getPUUID(rotated);
    // Shares the /userinfo response already fetched for the PUUID. A missing
    // Riot ID must never fail a connection that is otherwise valid.
    let riotId: RiotId | null = null;
    try {
      riotId = await client.getRiotId(rotated);
    } catch {
      riotId = null;
    }
    return { puuid, riotId, session: rotated };
  }
}
