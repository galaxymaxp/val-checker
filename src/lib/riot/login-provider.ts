import "server-only";

import { z } from "zod";

import {
  type CanonicalCookie,
  CookieJarError,
  cookieHeader,
  getSetCookieHeaders,
  parseCookieJar,
  rotateCookieJar,
  serializeCookieJar,
} from "@/src/lib/riot/cookie-jar";
import type { CapturedSession } from "@/src/lib/riot/session-provider";
import { createTlsTunedFetch } from "@/src/lib/riot/tls-fetch";

/**
 * Exchanges a Riot credential for a cookie jar (roadmap Version 2.4).
 *
 * The credential is transit-only. It is accepted as an argument, written into
 * exactly one request body, and then goes out of scope. It is never assigned to
 * an instance field, never returned, never logged, and never included in an
 * error. Everything this module hands back is jar material, which the caller
 * encrypts through the existing cipher.
 *
 * Endpoints are the documented auth flow:
 * https://valapidocs.techchrism.me/endpoint/auth-cookies
 * https://valapidocs.techchrism.me/endpoint/auth-request
 * https://valapidocs.techchrism.me/endpoint/multi-factor-authentication
 */

const AUTHORIZATION_URL = "https://auth.riotgames.com/api/v1/authorization";
const REQUEST_TIMEOUT_MS = 15_000;

// Matches the client.ts reauth parameters so the jar this produces is valid for
// the same cookie-reauth the daily worker performs later.
const AUTHORIZATION_REQUEST_BODY = {
  client_id: "play-valorant-web-prod",
  nonce: "1",
  redirect_uri: "https://playvalorant.com/opt_in",
  response_type: "token id_token",
  scope: "account openid",
} as const;

const RIOT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 256;
const MFA_CODE_PATTERN = /^[0-9]{6}$/;

export type RiotLoginFailure =
  | "invalid-credentials"
  | "invalid-mfa-code"
  | "malformed-input"
  | "rate-limited"
  | "unavailable";

/** Carries a classification only. Never a credential, cookie, or token. */
export class RiotLoginError extends Error {
  constructor(readonly failure: RiotLoginFailure) {
    super(`Riot login could not be completed: ${failure}.`);
    this.name = "RiotLoginError";
  }
}

export type RiotCredentialInput = {
  readonly password: string;
  readonly username: string;
};

export type RiotMfaInput = {
  readonly code: string;
  /** Serialized pending-auth jar from the credential step. */
  readonly pendingJar: Uint8Array;
};

export type RiotLoginOutcome =
  | {
      readonly kind: "connected";
      readonly session: CapturedSession;
    }
  | {
      readonly kind: "multifactor";
      /** Riot's masked hint, e.g. "a•••@example.com". Safe to show. */
      readonly maskedTarget: string | null;
      readonly method: string | null;
      /** Pending-auth jar the caller must encrypt and hold for the code step. */
      readonly pendingJar: Uint8Array;
    };

const successSchema = z.object({
  response: z.object({
    parameters: z.object({ uri: z.string().min(1) }),
  }),
  type: z.literal("response"),
});

const multifactorSchema = z.object({
  multifactor: z
    .object({
      email: z.string().optional(),
      method: z.string().optional(),
    })
    .loose()
    .optional(),
  multifactorEmail: z.string().optional(),
  type: z.literal("multifactor"),
});

const errorSchema = z.object({
  error: z.string().optional(),
  type: z.string(),
});

function classifyRiotError(error: string | undefined): RiotLoginFailure {
  switch (error) {
    case "auth_failure":
    case "invalid_session_id":
      return "invalid-credentials";
    case "multifactor_attempt_failed":
    case "invalid_multifactor_code":
      return "invalid-mfa-code";
    case "rate_limited":
      return "rate-limited";
    default:
      return "unavailable";
  }
}

export type RiotLoginProviderOptions = {
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
};

export class RiotLoginProvider {
  readonly kind = "riot-login" as const;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(options: RiotLoginProviderOptions = {}) {
    // Default transport is TLS-tuned; tests inject a plain fetch instead.
    this.fetchImplementation =
      options.fetchImplementation ?? createTlsTunedFetch();
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Opens the auth flow, submits the credential, and classifies Riot's answer.
   * `input.password` is referenced once, in the request body below.
   */
  async submitCredentials(
    input: RiotCredentialInput,
  ): Promise<RiotLoginOutcome> {
    const username = input.username?.trim() ?? "";

    if (
      typeof input.password !== "string" ||
      username.length === 0 ||
      username.length > MAX_USERNAME_LENGTH ||
      input.password.length === 0 ||
      input.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new RiotLoginError("malformed-input");
    }

    // Step one establishes the `asid` cookie that binds the following PUT.
    const opened = await this.send("POST", AUTHORIZATION_REQUEST_BODY, []);

    // Step two carries the credential. Nothing retains it past this call.
    const authenticated = await this.send(
      "PUT",
      {
        language: "en_US",
        password: input.password,
        remember: true,
        type: "auth",
        username,
      },
      opened.jar,
    );

    return this.classify(authenticated.payload, authenticated.jar);
  }

  /** Completes a challenged login using the pending-auth jar from step one. */
  async submitMfaCode(input: RiotMfaInput): Promise<RiotLoginOutcome> {
    const code = input.code?.trim() ?? "";
    if (!MFA_CODE_PATTERN.test(code)) {
      throw new RiotLoginError("invalid-mfa-code");
    }

    let pending: CanonicalCookie[];
    try {
      pending = parseCookieJar(input.pendingJar);
    } catch (error) {
      throw error instanceof CookieJarError
        ? new RiotLoginError("unavailable")
        : error;
    }

    const completed = await this.send(
      "PUT",
      { code, rememberDevice: true, type: "multifactor" },
      pending,
    );

    return this.classify(completed.payload, completed.jar);
  }

  private async send(
    method: "POST" | "PUT",
    body: unknown,
    jar: readonly CanonicalCookie[],
  ): Promise<{ jar: CanonicalCookie[]; payload: unknown }> {
    const requestUrl = new URL(AUTHORIZATION_URL);
    const requestTime = this.now();
    let response: Response;

    try {
      response = await this.fetchImplementation(AUTHORIZATION_URL, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: cookieHeader(jar, requestUrl, requestTime),
          "User-Agent": RIOT_USER_AGENT,
        },
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network-level detail is deliberately dropped: the request body held a
      // credential and must not reach a log or a wrapped error.
      throw new RiotLoginError("unavailable");
    }

    if (response.status === 429) {
      throw new RiotLoginError("rate-limited");
    }

    // Cloudflare answers a fingerprint challenge with 403 well before Riot sees
    // the request. Surfaced as unavailable so the caller can fall back.
    if (response.status === 403) {
      throw new RiotLoginError("unavailable");
    }

    if (!response.ok) {
      throw new RiotLoginError("unavailable");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RiotLoginError("unavailable");
    }

    return {
      jar: rotateCookieJar(
        jar,
        getSetCookieHeaders(response.headers),
        requestUrl,
        requestTime,
      ),
      payload,
    };
  }

  private classify(
    payload: unknown,
    jar: readonly CanonicalCookie[],
  ): RiotLoginOutcome {
    // Checked first: a rejected MFA code comes back as type "multifactor" with
    // an error field, so matching the challenge shape ahead of this would
    // re-prompt endlessly instead of reporting the bad code.
    const failed = errorSchema.safeParse(payload);
    if (
      failed.success &&
      typeof failed.data.error === "string" &&
      failed.data.error.length > 0
    ) {
      throw new RiotLoginError(classifyRiotError(failed.data.error));
    }

    const success = successSchema.safeParse(payload);
    if (success.success) {
      // The redirect URI carries an access token. It is intentionally not read:
      // the stored jar is the only artefact, and the worker mints its own token
      // through cookie-reauth when it needs one.
      if (jar.length === 0) {
        throw new RiotLoginError("unavailable");
      }

      return {
        kind: "connected",
        session: {
          capturedAt: this.now().toISOString(),
          fixtureOnly: false,
          kind: "captured-session",
          material: serializeCookieJar(jar),
          provider: this.kind,
        },
      };
    }

    const challenge = multifactorSchema.safeParse(payload);
    if (challenge.success) {
      const detail = challenge.data.multifactor;
      return {
        kind: "multifactor",
        maskedTarget:
          challenge.data.multifactorEmail ?? detail?.email ?? null,
        method: detail?.method ?? null,
        pendingJar: serializeCookieJar(jar),
      };
    }

    throw new RiotLoginError("unavailable");
  }
}
