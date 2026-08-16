import { app, BrowserWindow, clipboard, dialog } from "electron";

import { captureRiotJar } from "./riot-capture.js";

/**
 * Capture-only entry point.
 *
 * The full shell (main.ts) loads the web app so a signed-in operator can hand
 * the captured jar straight to connectRiotSession. That requires signing into
 * Supabase inside Electron, and Google refuses OAuth in an embedded browser —
 * a deliberate anti-phishing control, not a bug to defeat. Since the only thing
 * the desktop actually has to do is read Riot's cookies, this entry point drops
 * the web app entirely: it opens Riot's real login page, captures the jar, and
 * puts it on the clipboard for the operator to paste into the app in their
 * normal browser, where they are already authenticated.
 *
 * The jar is session material. It is placed on the clipboard because that is
 * where a paste comes from, and never written to disk or logged.
 */
app.whenReady().then(async () => {
  const result = await captureRiotJar();

  if (result.ok) {
    clipboard.writeText(result.jar);
    console.log("Riot capture: jar copied to clipboard.");
    await dialog.showMessageBox({
      type: "info",
      title: "Riot session captured",
      message: "Riot session captured and copied to your clipboard.",
      detail:
        "In your browser, open Riot connection, choose \"Use cookie export " +
        "instead (admin)\", paste into the field, and connect.\n\n" +
        "The clipboard holds session material until you copy something else.",
      buttons: ["Done"],
    });
  } else {
    const reasons: Record<typeof result.reason, string> = {
      cancelled: "The sign-in window was closed before Riot completed sign-in.",
      denied: "The sign-in was declined, interrupted, or did not finish (a " +
        "captcha or challenge may not have been completed).",
      timeout: "Timed out after five minutes waiting for sign-in to complete.",
      "no-cookies": "Sign-in appeared to complete but no session cookie was " +
        "found. Try again, making sure the sign-in fully finishes before the " +
        "window closes.",
    };
    console.log(`Riot capture failed: ${result.reason}`);
    await dialog.showMessageBox({
      type: "warning",
      title: "Riot session not captured",
      message: "Could not capture a Riot session.",
      detail: reasons[result.reason],
      buttons: ["Close"],
    });
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  app.quit();
});

app.on("window-all-closed", () => {
  // The capture flow owns the lifetime here; quitting is handled above so the
  // result dialog is not torn down with the login window.
});
