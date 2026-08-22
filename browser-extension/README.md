# VAL Checker Riot Connect

This private Chrome/Edge extension opens Riot's real authentication page and,
only after a successful OAuth redirect, submits the resulting Riot cookie jar
directly to VAL Checker's one-time capture endpoint.

## Install (Chrome or Edge desktop)

1. Download the extension ZIP from VAL Checker.
2. Unzip it with **Extract All**. Chrome cannot load the ZIP itself.
3. Open `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted `browser-extension` folder containing `manifest.json`.
7. Return to VAL Checker. It should say **Extension ready**.
8. Choose **Sign in with Riot**.

The extension cannot be installed in Chrome on iPhone, iPad, or Android. This
first automatic flow is desktop-only; the advanced cookie JSON fallback remains
available where cookie-export tooling exists.

## Security boundaries

- No password, MFA, CAPTCHA, keyboard, or mouse access.
- No permission to read unrelated browser tabs or browsing activity.
- Cookie access is limited to Riot Games hosts.
- Session material is sent directly from the extension background worker to
  VAL Checker and is never exposed to the VAL Checker webpage.
- OAuth fragment values are inspected only inside the extension. Raw access or
  ID tokens are never sent to the webpage, logged, or persisted.
- The handoff token is owner-bound, single-use, and expires after five minutes.
- Transient extension state is removed after success, failure, cancellation,
  or timeout.
