/**
 * Track C boundary from Build Spec §8. This file intentionally contains only
 * an interface. Implementations stay blocked until the durability gate passes.
 */
export interface Session {
  readonly kind: "captured-session";
}

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
