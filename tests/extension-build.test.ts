import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script, typed by its usage here.
import { ROOT_FOLDER, buildExtension } from "../scripts/build-extension.mjs";
import {
  BROWSER_ORDER,
  BROWSER_PROFILES,
  EXTENSION_PACKAGES,
  EXTENSION_ROOT_FOLDER,
} from "@/src/lib/extension/browsers";

const repoRoot = process.cwd();
const distRoot = join(repoRoot, "browser-extension", "dist");
const downloadRoot = join(repoRoot, "public", "downloads");

/** The archive filename each build is published under, per browser. */
const BUILD_FILENAMES = {
  chromium: BROWSER_ORDER.filter(
    (id) => BROWSER_PROFILES[id].build === "chromium",
  ).map((id) => EXTENSION_PACKAGES[id].filename),
  firefox: [EXTENSION_PACKAGES.firefox.filename],
} as const;

/**
 * Chromium wants a folder for "Load unpacked". Firefox wants a valid add-on
 * package, which means `manifest.json` at the archive root — nesting it makes
 * Firefox reject the file as corrupt.
 */
const BUILD_PREFIXES = {
  chromium: `${EXTENSION_ROOT_FOLDER}/`,
  firefox: "",
} as const;

/**
 * The archives under public/downloads are committed artifacts: `next build`
 * does not regenerate them, so Vercel ships exactly what is in git. Capture
 * them before the build below overwrites them, so a stale commit is caught
 * instead of silently handing users an old extension.
 */
const COMMITTED_ARCHIVES = new Map(
  (["chromium", "firefox"] as const).map((build) => [
    build,
    BUILD_FILENAMES[build].map((filename) => ({
      bytes: readFileSync(join(downloadRoot, filename)),
      filename,
    })),
  ]),
);

/** Inflates every entry of a ZIP, keyed by file name. */
function archiveContents(archive: Buffer) {
  const contents = new Map<string, string>();
  for (let index = 0; index < archive.length - 4; index += 1) {
    if (archive.readUInt32LE(index) !== 0x04034b50) continue;
    const method = archive.readUInt16LE(index + 8);
    const compressedSize = archive.readUInt32LE(index + 18);
    const nameLength = archive.readUInt16LE(index + 26);
    const extraLength = archive.readUInt16LE(index + 28);
    const nameEnd = index + 30 + nameLength;
    const name = archive.toString("utf8", index + 30, nameEnd);
    const bodyStart = nameEnd + extraLength;
    const body = archive.subarray(bodyStart, bodyStart + compressedSize);
    contents.set(
      name,
      (method === 8 ? inflateRawSync(body) : body).toString("utf8"),
    );
  }
  return contents;
}

/** Reads the file names out of a ZIP central directory. */
function archiveEntries(archive: Buffer) {
  const names: string[] = [];
  for (let index = 0; index < archive.length - 4; index += 1) {
    if (archive.readUInt32LE(index) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(index + 28);
    names.push(archive.toString("utf8", index + 46, index + 46 + nameLength));
  }
  return names.sort();
}

describe("extension build", () => {
  let built: Array<{ archive: string; target: string; version: string }>;

  beforeAll(async () => {
    built = await buildExtension();
  });

  it("produces one Chromium build and one Firefox build", () => {
    expect(built.map((entry) => entry.target).sort()).toEqual([
      "chromium",
      "firefox",
    ]);
  });

  it("writes exactly the archives the website links to", async () => {
    const downloads = (await readdir(downloadRoot)).sort();
    expect(downloads).toEqual(
      [...BUILD_FILENAMES.chromium, ...BUILD_FILENAMES.firefox].sort(),
    );
    // One download per supported browser, none of them named "chromium".
    expect(downloads).toHaveLength(BROWSER_ORDER.length);

    for (const build of ["chromium", "firefox"] as const) {
      const contents = await readdir(join(distRoot, build));
      const prefix = BUILD_PREFIXES[build];
      for (const filename of BUILD_FILENAMES[build]) {
        const archive = await readFile(join(downloadRoot, filename));
        expect(archiveEntries(archive)).toEqual(
          contents.map((name) => `${prefix}${name}`).sort(),
        );
        expect(archiveEntries(archive)).toContain(`${prefix}manifest.json`);
      }
    }
  });

  it("puts the Chromium manifest one folder deep and the Firefox one at the root", async () => {
    // "Load unpacked" needs a folder, so Chromium ships one ready-made.
    const chromium = archiveEntries(
      await readFile(join(downloadRoot, EXTENSION_PACKAGES.chrome.filename)),
    );
    expect(chromium).toContain(`${EXTENSION_ROOT_FOLDER}/manifest.json`);
    expect(chromium).not.toContain("manifest.json");
    for (const entry of chromium) {
      expect(entry.startsWith(`${EXTENSION_ROOT_FOLDER}/`)).toBe(true);
      // One folder deep exactly: no nested browser-extension/ wrapper.
      expect(entry.split("/")).toHaveLength(2);
    }

    // A Firefox add-on package must have manifest.json at the archive root.
    // Nested, Firefox reports "this add-on appears to be corrupt", and
    // addons.mozilla.org cannot sign it either.
    const firefox = archiveEntries(
      await readFile(join(downloadRoot, EXTENSION_PACKAGES.firefox.filename)),
    );
    expect(firefox).toContain("manifest.json");
    for (const entry of firefox) expect(entry).not.toContain("/");
  });

  it("keeps the build script and the website on the same folder name", () => {
    expect(ROOT_FOLDER).toBe(EXTENSION_ROOT_FOLDER);
    expect(ROOT_FOLDER).toBe("UNZIP ME");
  });

  it("ships identical bytes to every browser sharing a build", async () => {
    for (const build of ["chromium", "firefox"] as const) {
      const [first, ...rest] = await Promise.all(
        BUILD_FILENAMES[build].map((filename) =>
          readFile(join(downloadRoot, filename)),
        ),
      );
      for (const other of rest) expect(other.equals(first)).toBe(true);
    }
  });

  it("keeps the committed archives in step with the sources", async () => {
    // Compares inflated contents, not raw bytes, so a different zlib build
    // cannot make this fail spuriously.
    for (const build of ["chromium", "firefox"] as const) {
      const names = await readdir(join(distRoot, build));

      const prefix = BUILD_PREFIXES[build];
      for (const { bytes, filename } of COMMITTED_ARCHIVES.get(build)!) {
        const committed = archiveContents(bytes);
        expect([...committed.keys()].sort()).toEqual(
          names.map((name) => `${prefix}${name}`).sort(),
        );
        for (const name of names) {
          const fresh = await readFile(join(distRoot, build, name), "utf8");
          expect(
            committed.get(`${prefix}${name}`),
            `public/downloads is stale for ${filename} (${name}): run pnpm run extension:build and commit the archives`,
          ).toBe(fresh);
        }
      }
    }
  });

  it("ships the same implementation to both builds", async () => {
    const shared = ["background.js", "content.js", "riot-callback.js"];
    for (const name of shared) {
      const [chromium, firefox] = await Promise.all([
        readFile(join(distRoot, "chromium", name), "utf8"),
        readFile(join(distRoot, "firefox", name), "utf8"),
      ]);
      expect(chromium).toBe(firefox);
    }

    const [chromiumManifest, firefoxManifest] = await Promise.all([
      readFile(join(distRoot, "chromium", "manifest.json"), "utf8"),
      readFile(join(distRoot, "firefox", "manifest.json"), "utf8"),
    ]);
    const chromium = JSON.parse(chromiumManifest);
    const firefox = JSON.parse(firefoxManifest);

    // Only the manifest differs, and only where the engines require it.
    expect(chromium.permissions).toEqual(firefox.permissions);
    expect(chromium.host_permissions).toEqual(firefox.host_permissions);
    expect(chromium.content_scripts).toEqual(firefox.content_scripts);
    expect(chromium.version).toBe(firefox.version);
    expect(chromium.background).not.toEqual(firefox.background);
    expect(chromium.browser_specific_settings).toBeUndefined();
    expect(firefox.minimum_chrome_version).toBeUndefined();
  });
});
