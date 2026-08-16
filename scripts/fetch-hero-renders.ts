import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";

const VALORANT_API_WEAPONS_URL =
  "https://valorant-api.com/v1/weapons?language=en-US";

const OUTPUT_DIRECTORY = path.join(process.cwd(), "public", "hero");
const OUTPUT_WIDTH = 1280;
const WEBP_QUALITY = 82;

const weaponsSchema = z.object({
  data: z.array(
    z.object({
      displayName: z.string(),
      skins: z.array(
        z.object({
          chromas: z.array(
            z.object({
              fullRender: z.url().nullable(),
            }),
          ),
          displayName: z.string(),
        }),
      ),
    }),
  ),
});

type WeaponsPayload = z.infer<typeof weaponsSchema>;

interface PinnedSkin {
  readonly skinName: string;
  readonly slug: string;
  readonly weaponName: string;
}

const PINNED_SKINS: readonly PinnedSkin[] = [
  { skinName: "Prime Vandal", slug: "prime-vandal", weaponName: "Vandal" },
  { skinName: "Reaver Vandal", slug: "reaver-vandal", weaponName: "Vandal" },
  { skinName: "Oni Phantom", slug: "oni-phantom", weaponName: "Phantom" },
  { skinName: "Glitchpop Vandal", slug: "glitchpop-vandal", weaponName: "Vandal" },
  { skinName: "Ion Phantom", slug: "ion-phantom", weaponName: "Phantom" },
  { skinName: "Araxys Vandal", slug: "araxys-vandal", weaponName: "Vandal" },
];

function resolveRenderUrl(payload: WeaponsPayload, pinned: PinnedSkin): string {
  const weapon = payload.data.find(
    (candidate) =>
      candidate.displayName.toLowerCase() === pinned.weaponName.toLowerCase(),
  );

  if (!weapon) {
    throw new Error(`Weapon not found in catalog payload: ${pinned.weaponName}`);
  }

  const skin = weapon.skins.find(
    (candidate) =>
      candidate.displayName.toLowerCase() === pinned.skinName.toLowerCase(),
  );

  if (!skin) {
    const nearMisses = weapon.skins
      .map((candidate) => candidate.displayName)
      .filter((name) =>
        name.toLowerCase().includes(pinned.skinName.split(" ")[0].toLowerCase()),
      );

    throw new Error(
      `Skin "${pinned.skinName}" not found on ${pinned.weaponName}. ` +
        `Near misses: ${nearMisses.join(", ") || "(none)"}`,
    );
  }

  const render = skin.chromas[0]?.fullRender;

  if (!render) {
    throw new Error(`Skin "${pinned.skinName}" has no base chroma fullRender.`);
  }

  return render;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

try {
  const catalogResponse = await fetch(VALORANT_API_WEAPONS_URL);

  if (!catalogResponse.ok) {
    throw new Error(`Weapons request failed (${catalogResponse.status}).`);
  }

  const payload = weaponsSchema.parse(await catalogResponse.json());
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true });

  const summary: {
    readonly bytes: number;
    readonly height: number;
    readonly slug: string;
    readonly width: number;
  }[] = [];

  for (const pinned of PINNED_SKINS) {
    const renderUrl = resolveRenderUrl(payload, pinned);
    const original = await fetchBuffer(renderUrl);
    const { data, info } = await sharp(original)
      .resize({ width: OUTPUT_WIDTH, withoutEnlargement: false })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    await fs.writeFile(path.join(OUTPUT_DIRECTORY, `${pinned.slug}.webp`), data);
    summary.push({
      bytes: data.byteLength,
      height: info.height,
      slug: pinned.slug,
      width: info.width,
    });
  }

  console.table(summary);
  console.log(
    `Hero renders complete: ${summary.length} files, ` +
      `${summary.reduce((total, row) => total + row.bytes, 0)} bytes total.`,
  );
} catch (error) {
  const message =
    error instanceof z.ZodError
      ? "Valorant weapons response failed validation."
      : error instanceof Error
        ? error.message
        : "Hero render fetch failed.";
  console.error(message);
  process.exitCode = 1;
}
