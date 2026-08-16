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
 * The main window may only load the configured app origin plus *.supabase.co
 * (Supabase auth redirects). Everything else is refused.
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

  return (
    url.protocol === "https:" &&
    (url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co"))
  );
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
