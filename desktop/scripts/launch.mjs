import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Compiles the desktop sources and launches Electron, provisioning the Electron
 * runtime first if it is missing.
 *
 * Runnable as `node desktop/scripts/launch.mjs` from anywhere: paths resolve
 * from this file rather than the working directory, and nothing shells out to a
 * package manager, because `pnpm` is not on PATH here (it is reached through
 * corepack).
 *
 * The runtime is kept OUTSIDE the repository. The repo sits in a OneDrive-synced
 * folder, and OneDrive blocks the unpack of Electron's ~320 MB runtime into
 * node_modules: the download succeeds, the postinstall reports "Done", but
 * `dist/` ends up holding only `locales/` and Electron refuses to start.
 * ELECTRON_OVERRIDE_DIST_PATH is Electron's supported escape hatch.
 *
 * Because that runtime lives outside the tree, nothing in the repo guarantees it
 * is present — a cleaner, a reinstall, or antivirus can remove it. So rather
 * than failing with instructions, this extracts it from Electron's own download
 * cache when it goes missing. Set ELECTRON_DIST_DIR to relocate it.
 */
const desktopDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const ELECTRON_VERSION = "37.10.3";
const ZIP_NAME = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktopDir,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`exited with code ${code}`)),
    );
  });
}

function resolveDistDir() {
  if (process.env.ELECTRON_DIST_DIR) {
    return process.env.ELECTRON_DIST_DIR;
  }

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "electron-dist", ELECTRON_VERSION);
  }

  return path.join(desktopDir, "node_modules", "electron", "dist");
}

/** The runtime is only usable if the executable itself is there. */
function runtimeIsInstalled(distDir) {
  const executable = process.platform === "win32" ? "electron.exe" : "electron";
  return existsSync(path.join(distDir, executable));
}

/** Finds Electron's cached download, which survives a deleted runtime. */
function findCachedZip() {
  if (!process.env.LOCALAPPDATA) {
    return null;
  }

  const cacheRoot = path.join(process.env.LOCALAPPDATA, "electron", "Cache");
  if (!existsSync(cacheRoot)) {
    return null;
  }

  for (const entry of readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, entry, ZIP_NAME);
    if (existsSync(candidate) && statSync(candidate).size > 0) {
      return candidate;
    }
  }

  return null;
}

async function provisionRuntime(distDir) {
  const zip = findCachedZip();
  if (!zip) {
    throw new Error(
      `Electron runtime missing at ${distDir} and no cached ${ZIP_NAME} was found.\n` +
        "Run `corepack pnpm --filter val-checker-desktop rebuild electron` to " +
        "download it, then run this again.",
    );
  }

  console.log(`Electron runtime missing — extracting ${ZIP_NAME}...`);
  mkdirSync(distDir, { recursive: true });

  // bsdtar ships with Windows 10+ and handles zip, avoiding a dependency. It is
  // addressed by absolute path on purpose: a bare `tar` resolves to Git Bash's
  // GNU tar when run from that shell, which reads "C:\..." as a remote host spec
  // and fails with "Cannot connect to C: resolve failed".
  const tarBin =
    process.platform === "win32" && process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "tar.exe")
      : "tar";

  await run(tarBin, ["-xf", zip, "-C", distDir], { cwd: desktopDir });

  if (!runtimeIsInstalled(distDir)) {
    throw new Error(
      `Extraction to ${distDir} did not produce an Electron executable.`,
    );
  }

  console.log(`Electron runtime installed at ${distDir}`);
}

const distDir = resolveDistDir();

try {
  if (!runtimeIsInstalled(distDir)) {
    await provisionRuntime(distDir);
  }

  await run(process.execPath, [
    path.join(desktopDir, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    path.join(desktopDir, "tsconfig.json"),
  ]);

  // --capture runs the capture-only entry point: it skips the web app and goes
  // straight to Riot's login, putting the resulting jar on the clipboard. That
  // avoids signing into Supabase inside Electron, which Google blocks for OAuth.
  const captureOnly =
    process.argv.includes("--capture") || process.argv.includes("--register");
  const entry = captureOnly
    ? path.join(desktopDir, "dist", "capture-main.js")
    : ".";

  // Everything after the launcher's own flags is forwarded to the app, so
  // --register and --token=... reach it. The bare "--" separator keeps
  // Electron from interpreting them as its own options.
  const forwarded = process.argv.slice(2).filter((arg) => arg !== "--capture");

  await run(
    process.execPath,
    [
      path.join(desktopDir, "node_modules", "electron", "cli.js"),
      entry,
      ...(forwarded.length > 0 ? ["--", ...forwarded] : []),
    ],
    { env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: distDir } },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
