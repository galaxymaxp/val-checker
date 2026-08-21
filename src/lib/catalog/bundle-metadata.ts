import "server-only";

import { z } from "zod";

const BUNDLE_ENDPOINT = "https://valorant-api.com/v1/bundles";
/** Bundle art and naming change only when Riot ships a new bundle. */
const CACHE_SECONDS = 86_400;
const REQUEST_TIMEOUT_MS = 4_000;

const bundleResponseSchema = z.object({
  data: z.object({
    displayIcon: z.string().nullable(),
    displayName: z.string(),
    verticalPromoImage: z.string().nullable().optional(),
  }),
});

export interface BundleMetadata {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly promoImage: string | null;
}

/**
 * Resolves a bundle's name and artwork from valorant-api, which is the same
 * upstream the catalog sync already reads. Riot's storefront only identifies a
 * bundle by UUID, and bundles are not part of the synced catalog, so this is
 * read at render time behind a day-long cache.
 *
 * Returns null on any failure. The bundle panel degrades to prices and items,
 * which are already stored, rather than failing the dashboard.
 */
export async function loadBundleMetadata(
  bundleUuid: string,
): Promise<BundleMetadata | null> {
  try {
    const response = await fetch(`${BUNDLE_ENDPOINT}/${bundleUuid}`, {
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    const parsed = bundleResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }

    return {
      displayIcon: parsed.data.data.displayIcon,
      displayName: parsed.data.data.displayName,
      promoImage: parsed.data.data.verticalPromoImage ?? null,
    };
  } catch {
    return null;
  }
}
