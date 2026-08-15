/**
 * Cookie jar handling shared by the reauth client and the credential login
 * provider. Both need identical Set-Cookie semantics: the login exchange builds
 * a jar from nothing across several hops, and the daily worker rotates that same
 * jar afterwards. Divergence between the two would surface as a session that
 * connects and then silently fails to refresh.
 *
 * Cookie values are secrets. Nothing in this module logs, stringifies for
 * diagnostics, or includes a value in an error.
 */

export type CanonicalCookie = {
  readonly domain: string;
  readonly expires?: number;
  readonly hostOnly?: boolean;
  readonly httpOnly?: boolean;
  readonly name: string;
  readonly path: string;
  readonly sameSite?: string;
  readonly secure?: boolean;
  readonly value: string;
};

export type MutableCookie = {
  domain: string;
  expires?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  name: string;
  path: string;
  sameSite?: string;
  secure?: boolean;
  value: string;
};

/** Raised for malformed jar material. Carries no cookie value. */
export class CookieJarError extends Error {
  constructor() {
    super("Cookie jar material could not be parsed.");
    this.name = "CookieJarError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CookieJarError();
  }

  return value;
}

function cookieValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new CookieJarError();
  }

  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalExpiry(record: Record<string, unknown>): number | undefined {
  const value = record.expires ?? record.expirationDate;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return undefined;
}

export function normalizeCookie(value: unknown): CanonicalCookie {
  if (!isRecord(value)) {
    throw new CookieJarError();
  }

  if ("name" in value && "value" in value) {
    return {
      domain: requiredString(value, "domain")
        .trim()
        .toLowerCase()
        .replace(/\.$/, ""),
      expires: optionalExpiry(value),
      hostOnly: optionalBoolean(value, "hostOnly"),
      httpOnly: optionalBoolean(value, "httpOnly"),
      name: requiredString(value, "name"),
      path: optionalString(value, "path") ?? "/",
      sameSite: optionalString(value, "sameSite"),
      secure: optionalBoolean(value, "secure"),
      value: cookieValue(value, "value"),
    };
  }

  if ("Name raw" in value && "Content raw" in value) {
    const host = requiredString(value, "Host raw");
    let domain: string;

    try {
      domain = new URL(
        host.startsWith("http://") || host.startsWith("https://")
          ? host
          : `https://${host}`,
      ).hostname;
    } catch {
      throw new CookieJarError();
    }

    const rawExpiry = optionalString(value, "Expires raw");
    const parsedExpiry = rawExpiry ? Date.parse(rawExpiry) / 1_000 : Number.NaN;

    return {
      domain,
      expires:
        Number.isFinite(parsedExpiry) && parsedExpiry > 0
          ? parsedExpiry
          : undefined,
      name: requiredString(value, "Name raw"),
      path: optionalString(value, "Path raw") ?? "/",
      value: cookieValue(value, "Content raw"),
    };
  }

  throw new CookieJarError();
}

export function parseCookieJar(material: Uint8Array): CanonicalCookie[] {
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(material),
    );
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CookieJarError();
    }

    return parsed.map(normalizeCookie);
  } catch (error) {
    if (error instanceof CookieJarError) {
      throw error;
    }

    throw new CookieJarError();
  }
}

export function normalizedDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, "");
}

export function domainMatches(
  cookieDomain: string,
  requestHost: string,
  hostOnly = false,
): boolean {
  const domain = normalizedDomain(cookieDomain);
  return (
    domain.length > 0 &&
    (requestHost === domain || (!hostOnly && requestHost.endsWith(`.${domain}`)))
  );
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export function cookieHeader(
  cookies: readonly CanonicalCookie[],
  target: URL,
  now: Date,
): string {
  const nowInSeconds = now.getTime() / 1_000;

  return cookies
    .filter(
      (cookie) =>
        (!cookie.expires || cookie.expires > nowInSeconds) &&
        (!cookie.secure || target.protocol === "https:") &&
        domainMatches(cookie.domain, target.hostname, cookie.hostOnly) &&
        pathMatches(cookie.path, target.pathname),
    )
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function defaultCookiePath(requestPath: string): string {
  if (!requestPath.startsWith("/") || requestPath === "/") {
    return "/";
  }

  const lastSlash = requestPath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : requestPath.slice(0, lastSlash);
}

export function parseSetCookie(
  header: string,
  requestUrl: URL,
  now: Date,
): MutableCookie | null {
  const parts = header.split(";");
  const nameValue = parts.shift()?.trim() ?? "";
  const separator = nameValue.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const cookie: MutableCookie = {
    domain: requestUrl.hostname,
    hostOnly: true,
    name: nameValue.slice(0, separator).trim(),
    path: defaultCookiePath(requestUrl.pathname),
    value: nameValue.slice(separator + 1),
  };

  let maxAge: number | undefined;
  for (const part of parts) {
    const trimmed = part.trim();
    const attributeSeparator = trimmed.indexOf("=");
    const attributeName = (
      attributeSeparator === -1
        ? trimmed
        : trimmed.slice(0, attributeSeparator)
    ).toLowerCase();
    const attributeValue =
      attributeSeparator === -1
        ? ""
        : trimmed.slice(attributeSeparator + 1).trim();

    if (attributeName === "domain" && attributeValue) {
      if (!domainMatches(attributeValue, requestUrl.hostname)) {
        return null;
      }
      cookie.domain = attributeValue.toLowerCase();
      cookie.hostOnly = false;
    } else if (attributeName === "path" && attributeValue.startsWith("/")) {
      cookie.path = attributeValue;
    } else if (attributeName === "expires") {
      const expires = Date.parse(attributeValue) / 1_000;
      if (Number.isFinite(expires)) {
        cookie.expires = expires;
      }
    } else if (attributeName === "max-age") {
      const parsed = Number.parseInt(attributeValue, 10);
      if (Number.isFinite(parsed)) {
        maxAge = parsed;
      }
    } else if (attributeName === "secure") {
      cookie.secure = true;
    } else if (attributeName === "httponly") {
      cookie.httpOnly = true;
    } else if (attributeName === "samesite" && attributeValue) {
      cookie.sameSite = attributeValue;
    }
  }

  if (maxAge !== undefined) {
    cookie.expires = now.getTime() / 1_000 + maxAge;
  }

  return cookie;
}

export function rotateCookieJar(
  current: readonly CanonicalCookie[],
  setCookieHeaders: readonly string[],
  requestUrl: URL,
  now: Date,
): CanonicalCookie[] {
  const rotated: MutableCookie[] = current.map((cookie) => ({ ...cookie }));
  const nowInSeconds = now.getTime() / 1_000;

  for (const header of setCookieHeaders) {
    const replacement = parseSetCookie(header, requestUrl, now);
    if (!replacement) {
      continue;
    }

    const index = rotated.findIndex(
      (cookie) =>
        cookie.name === replacement.name &&
        normalizedDomain(cookie.domain) ===
          normalizedDomain(replacement.domain) &&
        cookie.path === replacement.path,
    );

    if (replacement.expires !== undefined && replacement.expires <= nowInSeconds) {
      if (index !== -1) {
        rotated.splice(index, 1);
      }
    } else if (index === -1) {
      rotated.push(replacement);
    } else {
      rotated[index] = replacement;
    }
  }

  return rotated;
}

export function serializeCookieJar(
  cookies: readonly CanonicalCookie[],
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(cookies));
}

export function getSetCookieHeaders(headers: Headers): string[] {
  return headers.getSetCookie();
}
