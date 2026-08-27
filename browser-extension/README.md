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

Every archive wraps its files in a single folder named exactly `UNZIP ME`, with
`manifest.json` directly inside it. Extracting therefore produces the folder
**Load unpacked** expects; no user ever has to create, rename, move, or
reorganise anything. `ROOT_FOLDER` in `scripts/build-extension.mjs` and
`EXTENSION_ROOT_FOLDER` in `src/lib/extension/browsers.ts` must stay in step,
and `tests/extension-build.test.ts` asserts they do.

## Browser support

| Build    | Browsers                             | Archives                                                          |
| -------- | ------------------------------------ | ----------------------------------------------------------------- |
| chromium | Chrome, Edge, Brave, Opera, Opera GX | `val-checker-chrome.zip`, `-edge`, `-brave`, `-opera`, `-opera-gx` |
| firefox  | Firefox                              | `val-checker-firefox-unsigned.zip`                                 |

Chromium browsers install byte-identical archives. The separate names exist so
the website can offer each browser its own download, and so a future
browser-specific build has somewhere to land without changing the website.

There is one implementation. The only engine differences are in the manifest —
Firefox has no Manifest V3 service worker, so it runs `background.scripts` as an
event page, and it needs a stable add-on id in `browser_specific_settings`.
Everything else, including the website handshake and the readiness signal, is
identical, so VAL Checker detects either build the same way.

`src/browser-api.js` resolves `browser` (Firefox) or `chrome` (Chromium) once.
Content scripts cannot import modules, so they repeat that single line; all
behaviour that differs by engine lives in the module.

## Install: Chrome, Edge, Brave, Opera, Opera GX

1. Download your browser's ZIP from VAL Checker (for example
   `val-checker-opera-gx.zip`).
2. Unzip it with **Extract All**. The browser cannot load the ZIP itself.
3. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `opera://extensions` — Opera GX uses `opera://extensions` too.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted `UNZIP ME` folder.
7. Return to VAL Checker. It should say **Extension ready**.
8. Choose **Sign in with Riot**.

## Install: Firefox

Mozilla signing is **not** configured yet, so there is no permanent install path
for release Firefox. The published Firefox artifact is a development build.

Development install:

1. Download `val-checker-firefox-unsigned.zip` and extract it.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `manifest.json` inside the
   extracted `UNZIP ME` folder.
4. Grant access to `riotgames.com` and `playvalorant.com` if Firefox asks.
   Manifest V3 host permissions are opt-in on Firefox; without them the
   background page reports `permissions-needed` instead of opening Riot.
5. Return to VAL Checker and confirm **Extension ready**.

A temporary add-on is removed when Firefox closes.

Production distribution (not yet done): submit `dist/firefox` to
addons.mozilla.org, and publish the signed result as
`val-checker-firefox.xpi`. Only then should the website offer a
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
