import type { RenderedEmail } from "@/src/lib/notifications/session-expired";
import type { StorefrontSkinMatch } from "@/src/lib/storefront/match";

export interface StorefrontMatchEmailInput {
  readonly displayName: string;
  readonly expiresAt: string;
  readonly match: StorefrontSkinMatch;
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
  const offerSections = input.match.offers.map((offer) => {
    const prices =
      offer.costs.length === 0
        ? "<p>No price was supplied for this offer.</p>"
        : [
            "<ul>",
            ...offer.costs.map(
              ({ amount, currencyUuid }) =>
                `<li><code>${escapeHtml(currencyUuid)}</code>: ${amount}</li>`,
            ),
            "</ul>",
          ].join("");

    return [
      "<section>",
      `<p>Offer <code>${escapeHtml(offer.offerId)}</code></p>`,
      prices,
      "</section>",
    ].join("");
  });
  const displayName = escapeHtml(input.displayName);
  const expiresAt = escapeHtml(input.expiresAt);

  return {
    subject: `${subjectName(input.displayName)} is in your VALORANT store`,
    html: [
      "<!doctype html>",
      '<html lang="en">',
      "<body>",
      `<h1>${displayName} is in your store</h1>`,
      `<p>The watched skin <code>${escapeHtml(input.match.skinUuid)}</code> is available today.</p>`,
      ...offerSections,
      `<p>This storefront rotation is expected to end at <time datetime="${expiresAt}">${expiresAt}</time>.</p>`,
      "<p>VAL Checker is not affiliated with Riot Games.</p>",
      "</body>",
      "</html>",
    ].join(""),
  };
}
