# VAL Checker Riot Connect

This private extension opens Riot's real authentication page and, only after a
successful OAuth redirect, submits the resulting Riot cookie jar directly to
VAL Checker's one-time capture endpoint.

## Layout

```
browser-extension/
├── src/                shared implementation (both builds)
│   ├── background.js   job lifecycle, cookie capture, submission
│   ├── browser-api.js  WebExtension namespace + host-permission check
│   ├── content.js      VAL Checker page bridge
│   ├── riot-callback.js  Riot callback observer
│   └── auth-callback.js  callback URL classifier
├── manifests/
│   ├── base.json       everything both engines share
│   ├── chromium.json   service worker + minimum Chrome version
│   └── firefox.json    event page + browser_specific_settings
└── dist/               build output (git ignored)
    ├── chromium/
    └── firefox/
```

Build both packages with:

```
pnpm run extension:build
```

That writes the unpacked builds to `dist/` and the archives to
`public/downloads/`.

## Browser support

| Build    | Browsers                                                |
| -------- | ------------------------------------------------------- |
| chromium | Chrome, Edge, Brave, Opera, Opera GX, other Chromium forks |
| firefox  | Firefox                                                   |

There is one implementation. The only engine differences are in the manifest —
Firefox has no Manifest V3 service worker, so it runs `background.scripts` as an
event page, and it needs a stable add-on id in `browser_specific_settings`.
Everything else, including the website handshake and the readiness signal, is
identical, so VAL Checker detects either build the same way.

`src/browser-api.js` resolves `browser` (Firefox) or `chrome` (Chromium) once.
Content scripts cannot import modules, so they repeat that single line; all
behaviour that differs by engine lives in the module.

## Install: Chrome, Edge, Brave, Opera, Opera GX

1. Download `val-checker-chromium-extension.zip` from VAL Checker.
2. Unzip it with **Extract All**. The browser cannot load the ZIP itself.
3. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `opera://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted folder containing `manifest.json`.
7. Return to VAL Checker. It should say **Extension ready**.
8. Choose **Sign in with Riot**.

## Install: Firefox

Mozilla signing is **not** configured yet, so there is no permanent install path
for release Firefox. The published Firefox artifact is a development build.

Development install:

1. Download `val-checker-firefox-extension-unsigned.zip` and extract it.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `manifest.json`.
4. Grant access to `riotgames.com` and `playvalorant.com` if Firefox asks.
   Manifest V3 host permissions are opt-in on Firefox; without them the
   background page reports `permissions-needed` instead of opening Riot.
5. Return to VAL Checker and confirm **Extension ready**.

A temporary add-on is removed when Firefox closes.

Production distribution (not yet done): submit `dist/firefox` to
addons.mozilla.org, and publish the signed result as
`val-checker-firefox-extension.xpi`. Only then should the website offer a
permanent Firefox install.

## Security boundaries

- No password, MFA, CAPTCHA, keyboard, or mouse access.
- No permission to read unrelated browser tabs or browsing activity.
- Cookie access is limited to Riot Games hosts.
- Page communication is limited to the VAL Checker origin in both builds.
- Session material is sent directly from the extension background context to
  VAL Checker and is never exposed to the VAL Checker webpage.
- OAuth fragment values are inspected only inside the extension. Raw access or
  ID tokens are never sent to the webpage, logged, or persisted.
- The handoff token is owner-bound, single-use, and expires after five minutes.
- Transient extension state is removed after success, failure, cancellation,
  or timeout.
