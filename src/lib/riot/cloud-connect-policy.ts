import "server-only";

import {
  loadRiotConnectAllowlist,
  RiotConnectNotAllowedError,
  type RiotConnectIdentity,
} from "@/src/lib/riot/connect-allowlist";

export type RiotCloudConnectEnvironment = Readonly<
  Record<string, string | undefined>
> & {
  readonly RIOT_CLOUD_CONNECT_ENABLED?: string;
  readonly RIOT_CLOUD_CONNECT_PUBLIC?: string;
};

export type RiotCloudConnectPolicy = {
  readonly enabled: boolean;
  readonly public: boolean;
};

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function loadRiotCloudConnectPolicy(
  environment: RiotCloudConnectEnvironment = process.env,
): RiotCloudConnectPolicy {
  return {
    enabled: enabled(environment.RIOT_CLOUD_CONNECT_ENABLED),
    public: enabled(environment.RIOT_CLOUD_CONNECT_PUBLIC),
  };
}

export function canUseRiotCloudConnect(
  identity: RiotConnectIdentity,
  environment: RiotCloudConnectEnvironment = process.env,
): boolean {
  const policy = loadRiotCloudConnectPolicy(environment);
  if (!policy.enabled) {
    return false;
  }
  return (
    policy.public ||
    loadRiotConnectAllowlist({
      RIOT_CONNECT_ALLOWED_EMAILS: environment.RIOT_CONNECT_ALLOWED_EMAILS,
      RIOT_CONNECT_ALLOWED_USER_IDS:
        environment.RIOT_CONNECT_ALLOWED_USER_IDS,
    }).allows(identity)
  );
}

export function assertRiotCloudConnectAllowed(
  identity: RiotConnectIdentity,
  environment: RiotCloudConnectEnvironment = process.env,
): void {
  if (!canUseRiotCloudConnect(identity, environment)) {
    throw new RiotConnectNotAllowedError();
  }
}
