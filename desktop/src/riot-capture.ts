import { BrowserWindow, session, type Cookie } from "electron";

/**
 * Riot login-window capture. Riot's credential API now demands an hCaptcha
 * token, so the server-side username/password path returns auth_failure. The
 * reliable alternative is to let the operator log in on Riot's REAL login page
 * inside a window whose browser session we own, then read the resulting cookie
 * jar with session.cookies.get() — something a plain browser popup cannot do
 * because the redirect lands on the cross-origin playvalorant.com.
 *
 * SECURITY: cookie values and the redirect URL (its fragment carries the access
 * token) are secrets. Nothing here logs a value, a URL, or the jar. Only counts
 * and outcomes are ever logged.
 */

// Matches REAUTH_URL in src/lib/riot/client.ts byte-for-byte, so the jar this
// produces is valid for the daily worker's cookie-reauth.
const REAUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";

// The access token is in the fragment of this redirect; we do NOT need it. We
// only need the cookies that Riot set on the auth domain.
const SUCCESS_PREFIX = "https://playvalorant.com/opt_in";

const RIOT_PARTITION = "persist:riot";
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

// Mirrors MAX_SUBMITTED_COOKIE_JAR_BYTES exported from
// src/lib/riot/session-provider.ts (128 KiB). Kept as a local literal because
// the desktop shell is a separate build that must not pull in the web app's
// server-only modules or their zod dependency.
const MAX_SUBMITTED_COOKIE_JAR_BYTES = 128 * 1024;

// Cookies the documented cookie-reauth flow actually relies on. Used only to
// shed bulk if a full export somehow exceeds the server's size ceiling.
const ESSENTIAL_COOKIE_NAMES = new Set([
  "ssid",
  "clid",
  "csid",
  "sub",
  "tdid",
  "asid",
  "did",
]);

export type RiotCaptureResult =
  | { readonly ok: true; readonly jar: string }
  | { readonly ok: false; readonly reason: "cancelled" | "timeout" | "no-cookies" };

/** The app's CanonicalCookie shape (see src/lib/riot/cookie-jar.ts). */
type CanonicalCookie = {
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

/**
 * Electron emits sameSite as "unspecified" | "no_restriction" | "lax" |
 * "strict" (older builds emit "no"). normalizeCookie in cookie-jar.ts stores
 * any non-empty string verbatim, so we map to a canonical lowercase token and
 * drop "unspecified" entirely rather than persist a meaningless attribute.
 */
function normalizeSameSite(value: string | undefined): string | undefined {
  switch (value) {
    case "strict":
      return "strict";
    case "lax":
      return "lax";
    case "no_restriction":
    case "no":
      return "no_restriction";
    default:
      return undefined;
  }
}

function toCanonicalCookie(cookie: Cookie): CanonicalCookie {
  const mapped: CanonicalCookie = {
    domain: cookie.domain ?? "",
    name: cookie.name,
    path: cookie.path && cookie.path.length > 0 ? cookie.path : "/",
    value: cookie.value,
  };

  // Session cookies carry no expirationDate; omit expires so cookie-jar.ts
  // treats them as session cookies rather than fabricating an expiry.
  if (cookie.session !== true && typeof cookie.expirationDate === "number") {
    mapped.expires = cookie.expirationDate;
  }
  if (typeof cookie.hostOnly === "boolean") {
    mapped.hostOnly = cookie.hostOnly;
  }
  if (typeof cookie.httpOnly === "boolean") {
    mapped.httpOnly = cookie.httpOnly;
  }
  if (typeof cookie.secure === "boolean") {
    mapped.secure = cookie.secure;
  }
  const sameSite = normalizeSameSite(cookie.sameSite);
  if (sameSite) {
    mapped.sameSite = sameSite;
  }

  return mapped;
}

function serializedByteLength(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8");
}

/**
 * Serialize to the app's jar format (a JSON array). Enforces the server's size
 * ceiling: if the full export is too large, shed non-essential cookies before
 * giving up, so we never emit something the server will reject.
 */
function buildJar(cookies: readonly Cookie[]): string | null {
  if (cookies.length === 0) {
    return null;
  }

  const canonical = cookies.map(toCanonicalCookie);
  const full = JSON.stringify(canonical);
  if (serializedByteLength(full) <= MAX_SUBMITTED_COOKIE_JAR_BYTES) {
    return full;
  }

  const essential = canonical.filter((cookie) =>
    ESSENTIAL_COOKIE_NAMES.has(cookie.name),
  );
  if (essential.length === 0) {
    return null;
  }

  const trimmed = JSON.stringify(essential);
  return serializedByteLength(trimmed) <= MAX_SUBMITTED_COOKIE_JAR_BYTES
    ? trimmed
    : null;
}

export function captureRiotJar(): Promise<RiotCaptureResult> {
  const riotSession = session.fromPartition(RIOT_PARTITION);
  const captureWindow = new BrowserWindow({
    width: 480,
    height: 720,
    show: true,
    autoHideMenuBar: true,
    title: "Sign in to Riot",
    webPreferences: {
      partition: RIOT_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  return new Promise<RiotCaptureResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onNavigate = (_event: unknown, url: string): void => {
      if (!settled && url.startsWith(SUCCESS_PREFIX)) {
        void onSuccess();
      }
    };

    const onClosed = (): void => {
      finish({ ok: false, reason: "cancelled" }, false);
    };

    async function cleanup(clearData: boolean): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      captureWindow.webContents.removeListener("will-redirect", onNavigate);
      captureWindow.webContents.removeListener("did-navigate", onNavigate);
      captureWindow.removeListener("closed", onClosed);
      if (clearData) {
        // Clear the persist:riot partition so the Riot login does not linger in
        // the desktop app; the jar is now stored server-side, encrypted.
        try {
          await riotSession.clearStorageData();
        } catch {
          // Best effort: a failed clear must not mask the capture outcome.
        }
      }
      if (!captureWindow.isDestroyed()) {
        captureWindow.destroy();
      }
    }

    function finish(result: RiotCaptureResult, clearData = true): void {
      if (settled) {
        return;
      }
      settled = true;
      void cleanup(clearData).then(() => resolve(result));
    }

    async function onSuccess(): Promise<void> {
      if (settled) {
        return;
      }
      try {
        const cookies = await riotSession.cookies.get({
          domain: "riotgames.com",
        });
        const jar = buildJar(cookies);
        if (!jar) {
          console.log("Riot capture: no usable cookies to submit.");
          finish({ ok: false, reason: "no-cookies" });
          return;
        }
        console.log(`Riot capture: captured ${cookies.length} cookies.`);
        finish({ ok: true, jar });
      } catch {
        console.log("Riot capture: cookie read failed.");
        finish({ ok: false, reason: "no-cookies" });
      }
    }

    captureWindow.webContents.on("will-redirect", onNavigate);
    captureWindow.webContents.on("did-navigate", onNavigate);
    captureWindow.on("closed", onClosed);

    timer = setTimeout(() => {
      finish({ ok: false, reason: "timeout" });
    }, CAPTURE_TIMEOUT_MS);

    // Navigation away to playvalorant.com aborts this load; that is expected and
    // handled by the redirect listeners, so ignore the rejection.
    captureWindow.loadURL(REAUTH_URL).catch(() => {
      // The success path is detected by navigation, not by this promise.
    });
  });
}
