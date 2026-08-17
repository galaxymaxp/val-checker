import path from "node:path";

import { app, BrowserWindow, clipboard, dialog } from "electron";

import { captureRiotJar } from "./riot-capture.js";

/**
 * Capture entry point.
 *
 * The full shell (main.ts) loads the web app so a signed-in operator can hand
 * the captured jar straight to connectRiotSession. That requires signing into
 * Supabase inside Electron, and Google refuses OAuth in an embedded browser —
 * a deliberate anti-phishing control, not a bug to defeat. So this entry drops
 * the web app entirely: it opens Riot's real login page and captures the jar.
 *
 * There are two ways the jar gets home:
 *
 *   * Deep link (preferred). The browser mints a one-time capture token and
 *     launches valchecker://capture?token=..., so this process POSTs the jar
 *     straight to /api/desktop/connect and the operator never handles session
 *     material at all.
 *   * Clipboard (fallback). With no token — a bare `--capture` run, or a
 *     machine where the protocol is not registered — the jar goes on the
 *     clipboard to be pasted in the browser, as before.
 *
 * The jar is session material: never written to disk, never logged. The token
 * is a bearer credential and is likewise never logged.
 */

const APP_URL = process.env.VAL_CHECKER_URL ?? "http://localhost:3000";
const PROTOCOL = "valchecker";

/** Pulls the capture token out of a valchecker://capture?token=... argv URL. */
function tokenFromDeepLink(value: string): string | null {
  if (!value.startsWith(`${PROTOCOL}://`)) {
    return null;
  }

  try {
    return new URL(value).searchParams.get("token");
  } catch {
    return null;
  }
}

/** Accepts either a protocol URL or an explicit --token= argument. */
function tokenFromArgv(argv: readonly string[]): string | null {
  for (const value of argv) {
    const deepLinkToken = tokenFromDeepLink(value);
    if (deepLinkToken) {
      return deepLinkToken;
    }
    if (value.startsWith("--token=")) {
      const explicit = value.slice("--token=".length);
      if (explicit.length > 0) {
        return explicit;
      }
    }
  }
  return null;
}

/**
 * Hands the jar to the web app. Returns a operator-facing message; the token
 * and jar are never included in it.
 */
async function postCapture(
  token: string,
  jar: string,
): Promise<{ detail: string; ok: boolean }> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/desktop/connect", APP_URL), {
      body: JSON.stringify({ jar, token }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    return {
      detail: `Could not reach ${APP_URL}. Check that the app is running and that VAL_CHECKER_URL points at it.`,
      ok: false,
    };
  }

  if (response.ok) {
    return { detail: "Your Riot account is connected. You can close this.", ok: true };
  }

  if (response.status === 401) {
    return {
      detail:
        "That capture link was already used or has expired. Start the connect again from your browser.",
      ok: false,
    };
  }

  if (response.status === 403) {
    return { detail: "Riot connection access is not enabled for this account.", ok: false };
  }

  return { detail: "The app rejected the captured session. Please try again.", ok: false };
}

async function runCapture(token: string | null): Promise<void> {
  const result = await captureRiotJar();

  if (!result.ok) {
    const reasons: Record<typeof result.reason, string> = {
      cancelled: "The sign-in window was closed before Riot completed sign-in.",
      denied:
        "The sign-in was declined, interrupted, or did not finish (a " +
        "captcha or challenge may not have been completed).",
      timeout: "Timed out after five minutes waiting for sign-in to complete.",
      "no-cookies":
        "Sign-in appeared to complete but no session cookie was " +
        "found. Try again, making sure the sign-in fully finishes before the " +
        "window closes.",
    };
    console.log(`Riot capture failed: ${result.reason}`);
    await dialog.showMessageBox({
      buttons: ["Close"],
      detail: reasons[result.reason],
      message: "Could not capture a Riot session.",
      title: "Riot session not captured",
      type: "warning",
    });
    return;
  }

  if (token) {
    const handoff = await postCapture(token, result.jar);
    console.log(
      handoff.ok
        ? "Riot capture: handed off to the app."
        : "Riot capture: hand-off rejected.",
    );
    await dialog.showMessageBox({
      buttons: ["Done"],
      detail: handoff.detail,
      message: handoff.ok
        ? "Riot session captured and connected."
        : "Riot session captured but not connected.",
      title: handoff.ok ? "Connected" : "Not connected",
      type: handoff.ok ? "info" : "warning",
    });
    return;
  }

  clipboard.writeText(result.jar);
  console.log("Riot capture: jar copied to clipboard.");
  await dialog.showMessageBox({
    buttons: ["Done"],
    detail:
      'In your browser, open Riot connection, choose "Use cookie export ' +
      'instead (admin)", paste into the field, and connect.\n\n' +
      "The clipboard holds session material until you copy something else.",
    message: "Riot session captured and copied to your clipboard.",
    title: "Riot session captured",
    type: "info",
  });
}

function shutdown(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  app.quit();
}

// A protocol launch on Windows and Linux starts a second process and passes
// the URL in argv. Route it into the instance already capturing rather than
// opening a competing Riot login window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const token = tokenFromArgv(argv);
    if (token) {
      void runCapture(token).finally(shutdown);
    }
  });

  // macOS delivers the deep link as an event instead of argv.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const token = tokenFromDeepLink(url);
    if (token) {
      void runCapture(token).finally(shutdown);
    }
  });

  app.whenReady().then(async () => {
    // In development Electron runs from its own binary, so the protocol has to
    // be registered against the script path for the OS to hand back a URL.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }

    await runCapture(tokenFromArgv(process.argv));
    shutdown();
  });
}

app.on("window-all-closed", () => {
  // The capture flow owns the lifetime here; quitting is handled above so the
  // result dialog is not torn down with the login window.
});
