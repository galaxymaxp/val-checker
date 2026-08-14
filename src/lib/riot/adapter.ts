import type { CapturedSession } from "@/src/lib/riot/session-provider";

/**
 * Riot network boundary. Phase 5 may build fixture-driven foundations, but the
 * ship gate remains closed and no live adapter implementation belongs here yet.
 */
export type Session = CapturedSession;

export interface Entitlements {
  readonly token: string;
}

export interface Storefront {
  readonly levelUuids: readonly string[];
}

export interface HealthStatus {
  readonly ok: boolean;
}

export interface RiotAdapter {
  authenticate(): Promise<Session>;
  refreshSession(session: Session): Promise<Session>;
  getEntitlements(session: Session): Promise<Entitlements>;
  getPUUID(session: Session): Promise<string>;
  getRegion(session: Session): Promise<string>;
  getStore(session: Session): Promise<Storefront>;
  healthCheck(): Promise<HealthStatus>;
}
