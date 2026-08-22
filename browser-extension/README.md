# VAL Checker Riot Connect

This private Chrome/Edge extension opens Riot's real authentication page and,
only after a successful OAuth redirect, submits the resulting Riot cookie jar
directly to VAL Checker's one-time capture endpoint.

## Install (Chrome or Edge desktop)

1. Download and unzip the extension package from VAL Checker.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the unzipped
   `browser-extension` folder.
4. Refresh the VAL Checker Riot connection page. It should say **Extension
   ready**.

The extension cannot be installed in Chrome on iPhone, iPad, or Android. This
first automatic flow is desktop-only; the advanced cookie JSON fallback remains
available where cookie-export tooling exists.

## Security boundaries

- No password, MFA, CAPTCHA, keyboard, or mouse access.
- No permission to read unrelated browser tabs or browsing activity.
- Cookie access is limited to Riot Games hosts.
- Session material is sent directly from the extension background worker to
  VAL Checker and is never exposed to the VAL Checker webpage.
- The handoff token is owner-bound, single-use, and expires after ten minutes.
- Transient extension state is removed after success, failure, cancellation,
  or timeout.
