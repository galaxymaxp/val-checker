import type { RenderedEmail } from "@/src/lib/notifications/session-expired";
import type { StorefrontSkinMatch } from "@/src/lib/storefront/match";

export interface StorefrontMatchEmailInput {
  readonly displayName: string;
  readonly expiresAt: string;
  /** Skin artwork, shown at the top. Omitted when the catalog has none. */
  readonly imageUrl?: string | null;
  readonly match: StorefrontSkinMatch;
  /** Price in Valorant Points, when the offer carries one. */
  readonly priceVp?: number | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "'": "&#39;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function subjectName(displayName: string): string {
  const normalized = displayName.replace(/[\r\n]+/g, " ").trim();
  return normalized || "A watched skin";
}

export function renderStorefrontMatchEmail(
  input: StorefrontMatchEmailInput,
): RenderedEmail {
  const displayName = escapeHtml(input.displayName);
  const expiresAt = escapeHtml(input.expiresAt);

  // Only http(s) artwork is embedded; anything else is dropped rather than
  // written into the message, since this value comes from catalog data.
  const artwork =
    input.imageUrl && /^https?:\/\//.test(input.imageUrl)
      ? `<p><img alt="" src="${escapeHtml(input.imageUrl)}" width="420" style="max-width:100%;height:auto"></p>`
      : "";

  const price =
    typeof input.priceVp === "number"
      ? `<p><strong>${input.priceVp.toLocaleString("en-US")} VP</strong></p>`
      : "";

  return {
    subject: `${subjectName(input.displayName)} is in your store!`,
    html: [
      "<!doctype html>",
      '<html lang="en">',
      "<body>",
      `<h1>${displayName} is in your store!</h1>`,
      artwork,
      price,
      `<p>It is available in today&#39;s rotation, which ends at <time datetime="${expiresAt}">${expiresAt}</time>.</p>`,
      "<p>VAL Checker is not affiliated with Riot Games.</p>",
      "</body>",
      "</html>",
    ].join(""),
  };
}
