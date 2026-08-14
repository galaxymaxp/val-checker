import type { CapturedSession } from "@/src/lib/riot/session-provider";

/** Riot network boundary. No Riot URL, header, or response type crosses it. */
export type Session = CapturedSession;

export interface Entitlements {
  readonly token: string;
}

export interface Storefront {
  readonly levelUuids: readonly string[];
  /** The single fetched response, retained for the existing pure pipeline. */
  readonly payload: unknown;
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
