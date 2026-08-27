// Builds the two browser packages from one shared extension source tree.
//
//   browser-extension/src        shared implementation
//   browser-extension/manifests  base manifest plus per-family overlays
//   browser-extension/dist       unpacked builds (git ignored)
//   public/downloads             the archives the website links to
//
// Run with: pnpm run extension:build
import { deflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(repoRoot, "browser-extension");
const sourceDir = join(extensionRoot, "src");
const manifestDir = join(extensionRoot, "manifests");
const distDir = join(extensionRoot, "dist");
const downloadDir = join(repoRoot, "public", "downloads");

/**
 * Chromium files sit inside this one folder, so "Load unpacked" has a folder
 * to select straight out of the extractor. Users must never have to create,
 * rename, or move a folder themselves.
 *
 * Keep this in step with `EXTENSION_ROOT_FOLDER` in
 * `src/lib/extension/browsers.ts`; `tests/extension-build.test.ts` asserts it.
 *
 * Chromium only. A Firefox add-on package is a ZIP with `manifest.json` at the
 * archive root; nest it under a folder and Firefox cannot find the manifest,
 * so handing the file to Firefox fails with "This add-on could not be
 * installed because it appears to be corrupt." The flat root layout is also
 * what addons.mozilla.org requires in order to sign the add-on.
 */
export const ROOT_FOLDER = "UNZIP ME";

/**
 * Chrome, Edge, Brave, Opera, and Opera GX all install the chromium build.
 * Firefox needs its own build because Manifest V3 background pages and
 * `browser_specific_settings` differ from Chromium.
 *
 * Each browser still gets its own archive name. The bytes are identical
 * within a build, but a user who downloads `val-checker-opera-gx.zip` should
 * never have to wonder whether a file named "chromium" is the right one, and
 * the names give any future per-browser build somewhere to land.
 *
 * The Firefox archive is deliberately named as an unsigned development
 * artifact. Rename it to `val-checker-firefox.xpi` only once the add-on is
 * actually signed by Mozilla, because an unsigned `.xpi` cannot be installed
 * permanently in release Firefox.
 */
const TARGETS = [
  {
    archives: [
      "val-checker-chrome.zip",
      "val-checker-edge.zip",
      "val-checker-brave.zip",
      "val-checker-opera.zip",
      "val-checker-opera-gx.zip",
    ],
    manifest: "chromium.json",
    name: "chromium",
    rootFolder: ROOT_FOLDER,
  },
  {
    archives: ["val-checker-firefox-unsigned.zip"],
    manifest: "firefox.json",
    name: "firefox",
    // Root of the archive. See ROOT_FOLDER above: a nested manifest makes
    // Firefox call the package corrupt.
    rootFolder: null,
  },
];

function mergeManifest(base, overlay) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key];
    merged[key] =
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? mergeManifest(current, value)
        : value;
  }
  return merged;
}

function referencedScripts(manifest) {
  const referenced = new Set();
  if (typeof manifest.background?.service_worker === "string") {
    referenced.add(manifest.background.service_worker);
  }
  for (const script of manifest.background?.scripts ?? []) {
    referenced.add(script);
  }
  for (const entry of manifest.content_scripts ?? []) {
    for (const script of entry.js ?? []) referenced.add(script);
  }
  return referenced;
}

// Minimal store/deflate ZIP writer. Avoids a build dependency for two archives.
const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = compressed.length < entry.data.length;
    const body = useDeflate ? compressed : entry.data;
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names.
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    // A fixed DOS timestamp keeps the archives byte-for-byte reproducible.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 2000-01-01.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    chunks.push(local, name, body);
    central.push(Buffer.concat([header, name]));
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, directory, end]);
}

export async function buildExtension() {
  const base = JSON.parse(await readFile(join(manifestDir, "base.json"), "utf8"));
  const sourceNames = (await readdir(sourceDir)).filter((name) =>
    name.endsWith(".js"),
  );
  const sources = await Promise.all(
    sourceNames.map(async (name) => ({
      // Normalise to LF so the archives are identical whether the checkout
      // converted line endings (Windows autocrlf) or not.
      data: Buffer.from(
        (await readFile(join(sourceDir, name), "utf8")).replaceAll(
          "\r\n",
          "\n",
        ),
        "utf8",
      ),
      name,
    })),
  );

  await rm(distDir, { force: true, recursive: true });
  await mkdir(downloadDir, { recursive: true });

  const built = [];
  for (const target of TARGETS) {
    const overlay = JSON.parse(
      await readFile(join(manifestDir, target.manifest), "utf8"),
    );
    const manifest = mergeManifest(base, overlay);

    for (const script of referencedScripts(manifest)) {
      if (!sourceNames.includes(script)) {
        throw new Error(
          `${target.name} manifest references missing script ${script}`,
        );
      }
    }

    const targetDir = join(distDir, target.name);
    await mkdir(targetDir, { recursive: true });
    const manifestJson = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(targetDir, "manifest.json"), manifestJson);
    for (const source of sources) {
      await writeFile(join(targetDir, source.name), source.data);
    }

    // Chromium archives are written under `UNZIP ME/`, so extracting produces
    // exactly the folder "Load unpacked" needs with manifest.json directly
    // inside it. Firefox archives stay flat so the package is a valid add-on.
    const archive = zip(
      [{ data: manifestJson, name: "manifest.json" }, ...sources].map(
        (entry) => ({
          ...entry,
          name: target.rootFolder
            ? `${target.rootFolder}/${entry.name}`
            : entry.name,
        }),
      ),
    );
    for (const name of target.archives) {
      await writeFile(join(downloadDir, name), archive);
    }
    built.push({
      archives: target.archives,
      bytes: archive.length,
      target: target.name,
      version: manifest.version,
    });
  }

  // Drop archives from an earlier naming scheme so the site never links to a
  // file that is no longer rebuilt. Only our own archives are considered.
  const expected = new Set(TARGETS.flatMap((target) => target.archives));
  for (const name of await readdir(downloadDir)) {
    if (/^val-checker-.*\.zip$/.test(name) && !expected.has(name)) {
      await rm(join(downloadDir, name));
    }
  }

  return built;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const result of await buildExtension()) {
    console.log(
      `${result.target} v${result.version} (${result.bytes} bytes) -> ${result.archives
        .map((name) => `public/downloads/${name}`)
        .join(", ")}`,
    );
  }
}
