import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type {
  Entitlements,
  FetchedStorefront,
  HealthStatus,
  RiotAdapter,
  Session,
} from "@/src/lib/riot/adapter";
import type { SessionCheckResult } from "@/src/lib/riot/session-lifecycle";
import {
  type CanonicalCookie,
  CookieJarError,
  cookieHeader,
  getSetCookieHeaders,
  parseCookieJar,
  rotateCookieJar,
  serializeCookieJar,
} from "@/src/lib/riot/cookie-jar";
import { extractStorefrontSkinLevelUuids } from "@/src/lib/storefront/schema";

const REAUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";
const ENTITLEMENTS_URL =
  "https://entitlements.auth.riotgames.com/api/token/v1";
const USERINFO_URL = "https://auth.riotgames.com/userinfo";
const CLIENT_VERSION_URL = "https://valorant-api.com/v1/version";

// Kept byte-for-byte with the successful agent/diag-reauth request.
export const RIOT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Canonical Windows value documented at
// https://valapidocs.techchrism.me/endpoint/storefront#other-variables
export const RIOT_CLIENT_PLATFORM =
  "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjog" +
  "IldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5" +
  "MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVu" +
  "a25vd24iDQp9";

const DEFAULT_REGION = "ap";
const REQUEST_TIMEOUT_MS = 15_000;

const riotUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);
const entitlementSchema = z.object({
  entitlements_token: z.string().min(1),
});
const userInfoSchema = z.object({ sub: riotUuidSchema });
const versionSchema = z.object({
  data: z.object({ riotClientVersion: z.string().min(1) }),
  status: z.literal(200),
});

type AuthorizationContext = {
  readonly accessToken: string;
  entitlementsToken?: string;
  puuid?: string;
  readonly sessionFingerprint: Uint8Array;
};

type PreparedStorefrontContext = {
  readonly accessToken: string;
  readonly clientVersion: string;
  readonly entitlementsToken: string;
  readonly puuid: string;
  readonly sessionFingerprint: Uint8Array;
};

type FailureClassification = Exclude<SessionCheckResult, "OK">;

export type RiotAccountConfig = {
  readonly region?: string | null;
};

export type RiotClientOptions = {
  readonly account?: RiotAccountConfig;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
  readonly session: Session;
};

export class RiotClientError extends Error {
  constructor(
    readonly classification: FailureClassification,
    readonly status: number | null = null,
  ) {
    super(
      classification === "DEAD"
        ? "Riot session requires reauthentication."
        : "Riot request could not be completed.",
    );
    this.name = "RiotClientError";
  }
}

export type StorefrontRequestDisposition =
  | "ambiguous"
  | "completed"
  | "not-sent";

/**
 * Adds only non-sensitive dispatch state to a Riot failure. The worker uses
 * this to decide whether an attempted shared lease may be closed safely: a
 * transport rejection can arrive after Riot received the request, while a
 * response or a preflight failure cannot still overlap another storefront.
 */
export class RiotStorefrontRequestError extends RiotClientError {
  constructor(
    classification: FailureClassification,
    status: number | null,
    readonly storefrontRequest: StorefrontRequestDisposition,
  ) {
    super(classification, status);
    this.name = "RiotStorefrontRequestError";
  }
}

function storefrontRequestError(
  error: unknown,
  disposition: StorefrontRequestDisposition,
): RiotStorefrontRequestError {
  if (error instanceof RiotClientError) {
    return new RiotStorefrontRequestError(
      error.classification,
      error.status,
      disposition,
    );
  }

  return new RiotStorefrontRequestError("ERROR", null, disposition);
}

function fingerprintSession(session: Session): Uint8Array {
  const digest = createHash("sha256");
  digest.update(
    JSON.stringify([
      session.capturedAt,
      session.fixtureOnly,
      session.kind,
      session.provider,
    ]),
    "utf8",
  );
  digest.update("\0", "utf8");
  digest.update(session.material);
  return new Uint8Array(digest.digest());
}

function sameSessionValue(
  expectedFingerprint: Uint8Array,
  session: Session,
): boolean {
  try {
    const candidateFingerprint = fingerprintSession(session);
    return timingSafeEqual(expectedFingerprint, candidateFingerprint);
  } catch {
    return false;
  }
}

export function classifyReauthLocation(location: string | null): SessionCheckResult {
  if (!location) {
    return "UNKNOWN";
  }

  try {
    const target = new URL(location, REAUTH_URL);
    if (
      target.hostname === "playvalorant.com" &&
      target.pathname === "/opt_in"
    ) {
      return "OK";
    }

    if (
      target.hostname === "authenticate.riotgames.com" &&
      (target.pathname === "/login" || target.pathname.startsWith("/login/"))
    ) {
      return "DEAD";
    }
  } catch {
    // An unparseable redirect is ambiguous, never authoritative session death.
  }

  return "UNKNOWN";
}

function accessTokenFromLocation(location: string): string | null {
  try {
    const target = new URL(location, REAUTH_URL);
    return new URLSearchParams(target.hash.slice(1)).get("access_token");
  } catch {
    return null;
  }
}

function normalizeRegion(value: string | null | undefined): string {
  const region = value?.trim().toLowerCase() || DEFAULT_REGION;
  if (region === "latam" || region === "br") {
    return "na";
  }
  if (region === "na" || region === "eu" || region === "ap" || region === "kr") {
    return region;
  }

  throw new RiotClientError("ERROR");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RiotClientError("UNKNOWN", response.status);
  }
}

function safeParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new RiotClientError("UNKNOWN");
  }

  return result.data;
}

/**
 * One-account, one-run Riot adapter. Access and entitlement tokens and the PUUID
 * exist only in this instance's private memory; the returned Session contains
 * only the complete rotated cookie jar.
 */
export class RiotClient implements RiotAdapter {
  private activeAuthorization: AuthorizationContext | null = null;
  private clientVersion: string | null = null;
  private initialSession: Session;
  private preparedStorefront: PreparedStorefrontContext | null = null;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly region: string;

  constructor(options: RiotClientOptions) {
    this.initialSession = options.session;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.region = normalizeRegion(options.account?.region);
  }

  async authenticate(): Promise<Session> {
    return this.refreshSession(this.initialSession);
  }

  async refreshSession(session: Session): Promise<Session> {
    this.activeAuthorization = null;
    this.preparedStorefront = null;
    let cookies: CanonicalCookie[];

    try {
      cookies = parseCookieJar(session.material);
    } catch (error) {
      // Malformed stored material stays an ERROR, as before the jar helpers moved.
      throw error instanceof CookieJarError
        ? new RiotClientError("ERROR")
        : error;
    }

    const requestUrl = new URL(REAUTH_URL);
    const requestTime = this.now();
    let response: Response;

    try {
      // Cookie Reauth: https://valapidocs.techchrism.me/endpoint/cookie-reauth
      response = await this.fetchImplementation(REAUTH_URL, {
        cache: "no-store",
        headers: {
          Cookie: cookieHeader(cookies, requestUrl, requestTime),
          "User-Agent": RIOT_USER_AGENT,
        },
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new RiotClientError("ERROR");
    }

    const location = response.headers.get("location");
    const classification = classifyReauthLocation(location);
    if (classification !== "OK") {
      throw new RiotClientError(classification, response.status);
    }

    const accessToken = accessTokenFromLocation(location ?? "");
    if (!accessToken) {
      throw new RiotClientError("UNKNOWN", response.status);
    }

    const rotatedCookies = rotateCookieJar(
      cookies,
      getSetCookieHeaders(response.headers),
      requestUrl,
      requestTime,
    );
    const refreshedSession: Session = {
      capturedAt: requestTime.toISOString(),
      fixtureOnly: session.fixtureOnly,
      kind: session.kind,
      material: serializeCookieJar(rotatedCookies),
      provider: session.provider,
    };

    this.initialSession = refreshedSession;
    this.activeAuthorization = {
      accessToken,
      sessionFingerprint: fingerprintSession(refreshedSession),
    };
    return refreshedSession;
  }

  async getEntitlements(session: Session): Promise<Entitlements> {
    const authorization = this.requireAuthorization(session);
    if (!authorization.entitlementsToken) {
      let response: Response;
      try {
        // https://valapidocs.techchrism.me/endpoint/entitlement
        response = await this.fetchImplementation(ENTITLEMENTS_URL, {
          body: "{}",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authorization.accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": RIOT_USER_AGENT,
          },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new RiotClientError("ERROR");
      }

      if (!response.ok) {
        throw new RiotClientError("UNKNOWN", response.status);
      }

      authorization.entitlementsToken = safeParse(
        entitlementSchema,
        await safeJson(response),
      ).entitlements_token;
    }

    return { token: authorization.entitlementsToken };
  }

  async getPUUID(session: Session): Promise<string> {
    const authorization = this.requireAuthorization(session);
    if (!authorization.puuid) {
      let response: Response;
      try {
        // https://valapidocs.techchrism.me/endpoint/player-info
        response = await this.fetchImplementation(USERINFO_URL, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authorization.accessToken}`,
            "User-Agent": RIOT_USER_AGENT,
          },
          method: "GET",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new RiotClientError("ERROR");
      }

      if (!response.ok) {
        throw new RiotClientError("UNKNOWN", response.status);
      }

      authorization.puuid = safeParse(
        userInfoSchema,
        await safeJson(response),
      ).sub;
    }

    return authorization.puuid;
  }

  async getRegion(session: Session): Promise<string> {
    void session;
    return this.region;
  }

  async prepareStorefront(session: Session): Promise<void> {
    try {
      const authorization = this.requireAuthorization(session);
      const entitlements = await this.getEntitlements(session);
      const puuid = await this.getPUUID(session);
      const clientVersion = await this.getClientVersion();
      this.preparedStorefront = {
        accessToken: authorization.accessToken,
        clientVersion,
        entitlementsToken: entitlements.token,
        puuid,
        sessionFingerprint: fingerprintSession(session),
      };
    } catch (error) {
      this.preparedStorefront = null;
      throw storefrontRequestError(error, "not-sent");
    }
  }

  async getStore(session: Session): Promise<FetchedStorefront> {
    let prepared = this.preparedStorefront;
    if (!prepared || !sameSessionValue(prepared.sessionFingerprint, session)) {
      // Direct adapter callers retain the original one-call API. The worker
      // always prepares before its database attempt fence, so this branch does
      // no I/O after that fence in the production worker path.
      await this.prepareStorefront(session);
      prepared = this.preparedStorefront;
    }
    if (!prepared) {
      throw new RiotStorefrontRequestError("ERROR", null, "not-sent");
    }

    const requestHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${prepared.accessToken}`,
      "User-Agent": RIOT_USER_AGENT,
      "X-Riot-ClientPlatform": RIOT_CLIENT_PLATFORM,
      "X-Riot-ClientVersion": prepared.clientVersion,
      "X-Riot-Entitlements-JWT": prepared.entitlementsToken,
    };
    const baseUrl = `https://pd.${this.region}.a.pvp.net/store`;
    let response: Response;

    try {
      // One fenced worker attempt must issue exactly one storefront request.
      // Choosing the current client route up front avoids a status-triggered
      // fallback that could otherwise spend a second request under one fence.
      response = await this.fetchImplementation(
        `${baseUrl}/v3/storefront/${prepared.puuid}`,
        {
          body: "{}",
          cache: "no-store",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      // A rejected/aborted fetch is ambiguous: Riot may have received it.
      throw new RiotStorefrontRequestError("ERROR", null, "ambiguous");
    }

    if (!response.ok) {
      throw new RiotStorefrontRequestError(
        "UNKNOWN",
        response.status,
        "completed",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
      return {
        levelUuids: extractStorefrontSkinLevelUuids(payload),
        payload,
      };
    } catch {
      throw new RiotStorefrontRequestError(
        "UNKNOWN",
        response.status,
        "completed",
      );
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.getClientVersion();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private requireAuthorization(session: Session): AuthorizationContext {
    if (
      !this.activeAuthorization ||
      !sameSessionValue(this.activeAuthorization.sessionFingerprint, session)
    ) {
      throw new RiotClientError("ERROR");
    }

    return this.activeAuthorization;
  }

  private async getClientVersion(): Promise<string> {
    if (this.clientVersion) {
      return this.clientVersion;
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(CLIENT_VERSION_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new RiotClientError("ERROR");
    }

    if (!response.ok) {
      throw new RiotClientError("UNKNOWN", response.status);
    }

    this.clientVersion = safeParse(
      versionSchema,
      await safeJson(response),
    ).data.riotClientVersion;
    return this.clientVersion;
  }
}
