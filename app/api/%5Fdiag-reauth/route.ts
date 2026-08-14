const REAUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type NormalizedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

type DiagnosticResult = {
  classification: string;
  status: number;
  headers: Record<string, string | string[]>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error("Invalid diagnostic cookie jar");
  }

  return value;
}

function normalizeCookie(value: unknown): NormalizedCookie {
  if (!isRecord(value)) {
    throw new Error("Invalid diagnostic cookie jar");
  }

  if ("name" in value && "value" in value) {
    return {
      name: requireString(value, "name"),
      value: requireString(value, "value"),
      domain: requireString(value, "domain"),
      path: requireString(value, "path"),
    };
  }

  if ("Name raw" in value && "Content raw" in value) {
    const host = requireString(value, "Host raw")
      .replace(/^https:\/\//, "")
      .replace(/^http:\/\//, "")
      .replace(/\/+$/, "");
    const path = value["Path raw"];

    if (path !== undefined && typeof path !== "string") {
      throw new Error("Invalid diagnostic cookie jar");
    }

    return {
      name: requireString(value, "Name raw"),
      value: requireString(value, "Content raw"),
      domain: host,
      path: path ?? "/",
    };
  }

  throw new Error("Invalid diagnostic cookie jar");
}

function domainMatches(cookieDomain: string, requestHost: string): boolean {
  const domain = cookieDomain.trim().toLowerCase().replace(/^\./, "");
  return (
    domain.length > 0 &&
    (requestHost === domain || requestHost.endsWith(`.${domain}`))
  );
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

function buildCookieHeader(serializedJar: string): string {
  const parsed: unknown = JSON.parse(serializedJar);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid diagnostic cookie jar");
  }

  const target = new URL(REAUTH_URL);
  return parsed
    .map(normalizeCookie)
    .filter(
      (cookie) =>
        domainMatches(cookie.domain, target.hostname) &&
        pathMatches(cookie.path, target.pathname),
    )
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function locationHost(location: string): string {
  if (!location) {
    return "";
  }

  try {
    return new URL(location, REAUTH_URL).hostname;
  } catch {
    return "";
  }
}

function sanitizeHeaders(headers: Headers): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};

  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase();
    if (lowerName === "location") {
      sanitized[name] = locationHost(value);
    } else if (lowerName !== "set-cookie") {
      sanitized[name] = value;
    }
  }

  const setCookies = headers.getSetCookie();
  if (setCookies.length > 0) {
    sanitized["set-cookie"] = setCookies.map(() => "[REDACTED]");
  }

  return sanitized;
}

export async function GET(): Promise<Response> {
  try {
    const serializedJar = process.env.RIOT_JAR_DIAG;
    if (!serializedJar) {
      throw new Error("Missing diagnostic cookie jar");
    }

    const cookieHeader = buildCookieHeader(serializedJar);
    const response = await fetch(REAUTH_URL, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
      },
      redirect: "manual",
      cache: "no-store",
    });
    const location = response.headers.get("location") ?? "";
    const classification = location.includes("playvalorant.com/opt_in")
      ? "OK"
      : location.includes("authenticate.riotgames.com/login")
        ? "DEAD"
        : `UNKNOWN_${response.status}`;

    const result: DiagnosticResult = {
      classification,
      status: response.status,
      headers: sanitizeHeaders(response.headers),
    };

    return Response.json(result);
  } catch {
    const result: DiagnosticResult = {
      classification: "UNKNOWN_500",
      status: 500,
      headers: {},
    };

    return Response.json(result, { status: 500 });
  }
}
