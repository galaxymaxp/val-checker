import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script, typed by its usage here.
import { buildExtension } from "../scripts/build-extension.mjs";
import { EXTENSION_PACKAGES } from "@/src/lib/extension/browsers";

const repoRoot = process.cwd();
const distRoot = join(repoRoot, "browser-extension", "dist");
const downloadRoot = join(repoRoot, "public", "downloads");

/**
 * The archives under public/downloads are committed artifacts: `next build`
 * does not regenerate them, so Vercel ships exactly what is in git. Capture
 * them before the build below overwrites them, so a stale commit is caught
 * instead of silently handing users an old extension.
 */
const COMMITTED_ARCHIVES = new Map(
  ["chromium", "firefox"].map((build) => {
    const filename =
      EXTENSION_PACKAGES[build as "chromium" | "firefox"].filename;
    return [build, readFileSync(join(downloadRoot, filename))];
  }),
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
      [
        EXTENSION_PACKAGES.chromium.filename,
        EXTENSION_PACKAGES.firefox.filename,
      ].sort(),
    );

    for (const [build, target] of [
      ["chromium", EXTENSION_PACKAGES.chromium],
      ["firefox", EXTENSION_PACKAGES.firefox],
    ] as const) {
      expect(target.href).toBe(`/downloads/${target.filename}`);
      const archive = await readFile(join(downloadRoot, target.filename));
      const entries = archiveEntries(archive);
      // manifest.json sits at the archive root so "Load unpacked" can take the
      // extracted folder directly.
      expect(entries).toContain("manifest.json");
      expect(entries).toEqual(
        (await readdir(join(distRoot, build))).sort(),
      );
    }
  });

  it("keeps the committed archives in step with the sources", async () => {
    // Compares inflated contents, not raw bytes, so a different zlib build
    // cannot make this fail spuriously.
    for (const build of ["chromium", "firefox"] as const) {
      const committed = archiveContents(COMMITTED_ARCHIVES.get(build)!);
      const names = await readdir(join(distRoot, build));

      expect([...committed.keys()].sort()).toEqual(names.sort());
      for (const name of names) {
        const fresh = await readFile(join(distRoot, build, name), "utf8");
        expect(
          committed.get(name),
          `public/downloads is stale for ${build}/${name}: run pnpm run extension:build and commit the archives`,
        ).toBe(fresh);
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
