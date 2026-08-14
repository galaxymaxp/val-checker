import "server-only";

import type { RiotAdapter, Session } from "@/src/lib/riot/adapter";
import type { SessionStore } from "@/src/lib/riot/session-store";

export class ReauthPersistenceRunError extends Error {
  readonly classification = "ERROR" as const;

  constructor() {
    super("Rotated Riot session persistence failed.");
    this.name = "ReauthPersistenceRunError";
  }
}

type ReauthPersistenceDependencies = {
  readonly adapter: Pick<RiotAdapter, "refreshSession">;
  readonly expectedConnectionEpoch: string;
  readonly session: Session;
  readonly store: Pick<SessionStore, "persistRotated">;
  readonly userId: string;
};

/**
 * Reauthenticates and durably stores the complete rotated jar before releasing
 * the refreshed session to any later Riot step in the run.
 */
export async function reauthenticateAndPersist({
  adapter,
  expectedConnectionEpoch,
  session,
  store,
  userId,
}: ReauthPersistenceDependencies): Promise<Session> {
  const rotatedSession = await adapter.refreshSession(session);

  try {
    await store.persistRotated(
      userId,
      rotatedSession,
      expectedConnectionEpoch,
    );
  } catch {
    throw new ReauthPersistenceRunError();
  }

  return rotatedSession;
}
