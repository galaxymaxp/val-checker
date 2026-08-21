import "server-only";

import { z } from "zod";

const configuredUserIdSchema = z.uuid();
const configuredEmailSchema = z.email();

export type RiotConnectIdentity = {
  readonly email?: string;
  readonly userId: string;
};

export type RiotConnectAllowlistEnvironment = {
  readonly RIOT_CONNECT_ALLOWED_EMAILS?: string;
  readonly RIOT_CONNECT_ALLOWED_USER_IDS?: string;
};

export class RiotConnectAllowlistConfigurationError extends Error {
  constructor() {
    super("The Riot connection allowlist is invalid.");
    this.name = "RiotConnectAllowlistConfigurationError";
  }
}

export class RiotConnectNotAllowedError extends Error {
  constructor() {
    super("This account is not permitted to connect a Riot session.");
    this.name = "RiotConnectNotAllowedError";
  }
}

function parseConfiguredList(
  value: string | undefined,
  schema: z.ZodType<string>,
  normalize: (entry: string) => string,
): Set<string> {
  if (value === undefined || value.trim() === "") {
    return new Set();
  }

  const entries = value.split(",").map((entry) => normalize(entry.trim()));
  if (
    entries.some((entry) => entry.length === 0 || !schema.safeParse(entry).success)
  ) {
    throw new RiotConnectAllowlistConfigurationError();
  }

  return new Set(entries);
}

/** Shared membership test over a configured user-id and email list. */
class IdentityAllowlist {
  private readonly allowedEmails: ReadonlySet<string>;
  private readonly allowedUserIds: ReadonlySet<string>;

  constructor(userIds: string | undefined, emails: string | undefined) {
    this.allowedUserIds = parseConfiguredList(
      userIds,
      configuredUserIdSchema,
      (userId) => userId.toLowerCase(),
    );
    this.allowedEmails = parseConfiguredList(
      emails,
      configuredEmailSchema,
      (email) => email.toLowerCase(),
    );
  }

  allows(identity: RiotConnectIdentity): boolean {
    const normalizedUserId = identity.userId.trim().toLowerCase();
    const normalizedEmail = identity.email?.trim().toLowerCase();

    return (
      this.allowedUserIds.has(normalizedUserId) ||
      (normalizedEmail !== undefined && this.allowedEmails.has(normalizedEmail))
    );
  }
}

export class RiotConnectAllowlist extends IdentityAllowlist {
  constructor(environment: RiotConnectAllowlistEnvironment) {
    super(
      environment.RIOT_CONNECT_ALLOWED_USER_IDS,
      environment.RIOT_CONNECT_ALLOWED_EMAILS,
    );
  }

  assertAllowed(identity: RiotConnectIdentity): void {
    if (!this.allows(identity)) {
      throw new RiotConnectNotAllowedError();
    }
  }
}

export function loadRiotConnectAllowlist(
  environment: RiotConnectAllowlistEnvironment = {
    RIOT_CONNECT_ALLOWED_EMAILS: process.env.RIOT_CONNECT_ALLOWED_EMAILS,
    RIOT_CONNECT_ALLOWED_USER_IDS:
      process.env.RIOT_CONNECT_ALLOWED_USER_IDS,
  },
): RiotConnectAllowlist {
  return new RiotConnectAllowlist(environment);
}

export function canRiotConnect(identity: RiotConnectIdentity): boolean {
  return loadRiotConnectAllowlist().allows(identity);
}
