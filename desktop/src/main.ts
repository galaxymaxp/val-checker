import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { captureRiotJar } from "./riot-capture.js";

/**
 * Thin Electron shell that loads the EXISTING VAL Checker web app and adds one
 * privileged bridge method (Riot login capture). Because the operator is signed
 * into Supabase inside this shell, the captured jar can be handed straight to
 * the existing connectRiotSession server action — no pairing flow, no new API.
 */

const APP_URL = process.env.VAL_CHECKER_URL ?? "http://localhost:3000";

/**
 * Hosts the sign-in flow legitimately passes through. Supabase issues the
 * OAuth redirect, and the identity provider serves the consent screen, so
 * blocking the provider's own host breaks sign-in outright rather than
 * hardening anything.
 */
const AUTH_HOST_SUFFIXES = [
  "supabase.co",
  "accounts.google.com",
  "google.com",
  "googleusercontent.com",
];

/**
 * The main window may only load the configured app origin plus the hosts the
 * sign-in flow traverses. Everything else is refused.
 */
function isAllowedOrigin(target: string): boolean {
  let url: URL;
  let appOrigin: URL;
  try {
    url = new URL(target);
    appOrigin = new URL(APP_URL);
  } catch {
    return false;
  }

  if (url.origin === appOrigin.origin) {
    return true;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  return AUTH_HOST_SUFFIXES.some(
    (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
  );
}

/**
 * Electron's default user agent carries an "Electron/<version>" token, and
 * Google refuses OAuth from a user agent it reads as an embedded webview,
 * answering with disallowed_useragent instead of a consent screen. Stripping
 * the Electron and application tokens leaves the Chrome identity this window
 * genuinely is — a real Chromium browser the operator drives themselves.
 */
function browserUserAgent(): string {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, "")
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, "i"), "");
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 820,
    show: true,
    title: "VAL Checker",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
    },
  });

  window.webContents.setUserAgent(browserUserAgent());

  // Block navigation to any origin other than the configured one (+ Supabase).
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedOrigin(url)) {
      event.preventDefault();
    }
  });

  // Block popups / target=_blank to anywhere that is not allowed.
  window.webContents.setWindowOpenHandler(({ url }) =>
    isAllowedOrigin(url) ? { action: "allow" } : { action: "deny" },
  );

  void window.loadURL(APP_URL);
}

ipcMain.handle("val-checker:connect-riot", () => captureRiotJar());

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
