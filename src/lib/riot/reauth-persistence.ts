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
  readonly connectionId: string;
  readonly expectedConnectionEpoch: string;
  readonly rotationLeaseToken: string;
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
  connectionId,
  expectedConnectionEpoch,
  rotationLeaseToken,
  session,
  store,
  userId,
}: ReauthPersistenceDependencies): Promise<Session> {
  const rotatedSession = await adapter.refreshSession(session);

  try {
    await store.persistRotated(
      userId,
      connectionId,
      rotatedSession,
      expectedConnectionEpoch,
      rotationLeaseToken,
    );
  } catch {
    throw new ReauthPersistenceRunError();
  }

  return rotatedSession;
}
