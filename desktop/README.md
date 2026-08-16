# VAL Checker desktop shell

A thin [Electron](https://www.electronjs.org/) window that loads the existing
VAL Checker web app and adds **one** privileged capability: signing in on Riot's
real login page and capturing the resulting session cookies.

## Why this exists

Riot's credential API now requires an hCaptcha token, so the web app's
username/password connect path returns `auth_failure` even with correct
credentials. The documented alternative is to let the user log in on Riot's real
login page and capture the session that results. A browser popup can't read that
session (the redirect lands on the cross-origin `playvalorant.com`), but an
Electron app owns its browser session and can read the cookies directly.

The captured jar is handed to the **existing** `connectRiotSession` server
action — the same one the admin cookie-paste fallback uses. Because you are
already signed into Supabase inside the shell, there is no pairing flow and no
new API route.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  window. No `webSecurity: false` anywhere.
- The preload exposes only `window.valChecker = { isDesktop, connectRiot() }`.
  No generic IPC, no `fs`, no `shell`.
- The Riot login runs in its own `persist:riot` partition, which is **cleared**
  after each capture so the login does not linger on disk.
- Cookie values, the jar, and the redirect URL (its fragment carries an access
  token) are never logged. Only counts and outcomes are logged.

## Running it

From the repository root, use `corepack pnpm` — bare `pnpm` is not on PATH.

1. Install once (from the repo root, installs the workspace including this
   package):

   ```sh
   corepack pnpm install
   ```

2. Start the Next.js web app in one terminal:

   ```sh
   corepack pnpm dev
   ```

3. Start the desktop shell in another terminal, pointing it at the running web
   app:

   ```sh
   # from the repo root
   VAL_CHECKER_URL=http://localhost:3000 corepack pnpm desktop

   # or from this directory
   VAL_CHECKER_URL=http://localhost:3000 corepack pnpm dev
   ```

   `VAL_CHECKER_URL` defaults to `http://localhost:3000` if unset. On Windows
   PowerShell, set it with `$env:VAL_CHECKER_URL = "http://localhost:3000"`
   before the command.

Once the shell is open and you are signed into VAL Checker, the Riot connection
page shows a **"Sign in to Riot (desktop)"** button. Clicking it opens Riot's
own login window; on success the captured session is connected automatically.

## Scripts

- `dev` — compile TypeScript and launch Electron.
- `build` — compile TypeScript to `dist/`.
- `start` — launch Electron against an already-built `dist/`.
- `typecheck` — type-check with this package's own `tsconfig.json`.

## Layout

```
desktop/
  package.json        name "val-checker-desktop", private, type module
  tsconfig.json       its own config (NodeNext), separate from the root program
  src/main.ts         Electron main process (main window + IPC handler)
  src/preload.cts     contextBridge (CommonJS — sandboxed preloads must be CJS)
  src/riot-capture.ts login-window + cookie capture logic
```

## OneDrive caveat (important)

This repository lives inside a OneDrive-synced folder, and OneDrive blocks the
extraction of Electron's ~320 MB runtime into `node_modules`. The symptom is
misleading: the download succeeds (the ~128 MB zip lands in
`%LOCALAPPDATA%\electron\Cache`), the postinstall reports "Done", but
`node_modules/electron/dist` ends up containing only `locales/`, and launching
fails with:

    Electron failed to install correctly, please delete node_modules/electron
    and try installing again

Reinstalling does not help, because the download is already cached and intact —
it is the unpack into the synced folder that fails.

The runtime is therefore kept outside the synced tree at
`%LOCALAPPDATA%\electron-dist\37.10.3`, and `scripts/launch.mjs` points Electron
at it through `ELECTRON_OVERRIDE_DIST_PATH`. Set `ELECTRON_DIST_DIR` to override
that location.

To reinstall the runtime by hand:

```bash
# unzip the cached archive to a directory outside OneDrive
unzip "$LOCALAPPDATA/electron/Cache/<hash>/electron-v37.10.3-win32-x64.zip" \
  -d "$LOCALAPPDATA/electron-dist/37.10.3"
printf 'electron.exe' > node_modules/electron/path.txt
```

The durable fix is to move the repository out of OneDrive. The same interference
also causes the intermittent `EPERM: unlink .next\...` build failures.
