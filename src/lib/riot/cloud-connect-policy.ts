import "server-only";

import type { RiotConnectIdentity } from "@/src/lib/riot/connect-identity";

export type RiotCloudConnectEnvironment = Readonly<
  Record<string, string | undefined>
> & {
  readonly RIOT_CLOUD_CONNECT_ENABLED?: string;
};

export type RiotCloudConnectPolicy = {
  readonly enabled: boolean;
};

export class RiotCloudConnectUnavailableError extends Error {
  constructor() {
    super("Riot cloud connection is not enabled.");
    this.name = "RiotCloudConnectUnavailableError";
  }
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function loadRiotCloudConnectPolicy(
  environment: RiotCloudConnectEnvironment = process.env,
): RiotCloudConnectPolicy {
  return {
    enabled: enabled(environment.RIOT_CLOUD_CONNECT_ENABLED),
  };
}

export function canUseRiotCloudConnect(
  _identity: RiotConnectIdentity,
  environment: RiotCloudConnectEnvironment = process.env,
): boolean {
  return loadRiotCloudConnectPolicy(environment).enabled;
}

export function assertRiotCloudConnectAllowed(
  identity: RiotConnectIdentity,
  environment: RiotCloudConnectEnvironment = process.env,
): void {
  if (!canUseRiotCloudConnect(identity, environment)) {
    throw new RiotCloudConnectUnavailableError();
  }
}
