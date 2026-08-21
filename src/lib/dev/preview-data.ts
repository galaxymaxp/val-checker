import { isDevPreviewNightMarket } from "@/src/lib/dev/preview";
import type { InventoryTileView } from "@/src/types/catalog-view";
import type { RiotAccountView } from "@/src/lib/riot/connection-state";
import type { DailyShopView } from "@/src/lib/storefront/daily-shop";
import type { StorefrontDashboardStatus } from "@/src/lib/storefront/dashboard-status";

const MEDIA = "https://media.valorant-api.com";
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

function storeDay(now: Date): {
  nextResetAt: string;
  storeDate: string;
} {
  const nextReset = new Date(now);
  nextReset.setUTCHours(0, 0, 0, 0);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  return {
    nextResetAt: nextReset.toISOString(),
    storeDate: now.toISOString().slice(0, 10),
  };
}

export function previewAccounts(now: Date): readonly RiotAccountView[] {
  const connectedAt = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  return [
    {
      authStatus: "CONNECTED",
      connectedAt,
      gameName: "preview",
      id: CONNECTION_ID,
      label: "preview#dev1",
      lastRefreshAt: new Date(now.getTime() - 3_600_000).toISOString(),
      region: "ap",
      tagLine: "dev1",
    },
    {
      authStatus: "REAUTH_REQUIRED",
      connectedAt,
      gameName: "preview",
      id: SECOND_CONNECTION_ID,
      label: "preview#dev2",
      lastRefreshAt: null,
      region: "ap",
      tagLine: "dev2",
    },
  ];
}

export function previewRefreshStatus(now: Date): StorefrontDashboardStatus {
  const { nextResetAt, storeDate } = storeDay(now);
  const checkedAt = new Date(now.getTime() - 3_600_000).toISOString();

  return {
    accounts: [CONNECTION_ID, SECOND_CONNECTION_ID].map((connectionId) => ({
      connectionId,
      lastAutomaticAttemptAt: checkedAt,
      lastAutomaticSuccessAt: checkedAt,
      lastManualAttemptAt: null,
      lastManualSuccessAt: null,
      manualAvailability: "available" as const,
      manualUnavailableReason: null,
      nextAutomaticAt: nextResetAt,
      nextManualAt: nextResetAt,
      recentFailureReason: null,
    })),
    nextResetAt,
    storeDate,
  };
}

/**
 * A storefront with a bundle and a running night market. The night market is
 * the reason this exists: Riot runs one a few weeks a year, so it is otherwise
 * impossible to look at the panel that renders it.
 */
export function previewDailyShops(now: Date): readonly DailyShopView[] {
  const { nextResetAt, storeDate } = storeDay(now);
  const offer = (
    name: string,
    skinUuid: string,
    icon: string,
    price: number,
    tierName: string,
    weaponName: string,
    watched = false,
  ) => ({
    displayIcon: `${MEDIA}/weaponskins/${icon}/displayicon.png`,
    displayName: name,
    price,
    skinUuid,
    tierName,
    watched,
    weaponName,
  });

  return [
    {
      bundle: {
        displayIcon: `${MEDIA}/bundles/4d368017-4f98-1e89-dbec-31abd2533eb9/displayicon.png`,
        displayName: "Neo Frontier",
        expiresAt: nextResetAt,
        items: [
          {
            displayIcon: `${MEDIA}/weaponskins/38d47ee7-414d-8cee-5bbd-aca16656cda9/displayicon.png`,
            displayName: "Neo Frontier Lasso",
            price: 3350,
            skinUuid: "38d47ee7-414d-8cee-5bbd-aca16656cda9",
          },
          {
            displayIcon: `${MEDIA}/weaponskins/5ef15ada-4332-093f-ea15-8a8891d863d0/displayicon.png`,
            displayName: "Neo Frontier Vandal",
            price: 1775,
            skinUuid: "5ef15ada-4332-093f-ea15-8a8891d863d0",
          },
        ],
        otherItemCount: 4,
        totalBaseCost: 9775,
        totalDiscountedCost: 6700,
        totalDiscountPercent: 0.315,
      },
      checkedAt: new Date(now.getTime() - 3_600_000).toISOString(),
      connectionId: CONNECTION_ID,
      expiresAt: nextResetAt,
      label: "preview#dev1",
      nightMarket: isDevPreviewNightMarket()
        ? {
        expiresAt: nextResetAt,
        offers: [
          {
            basePrice: 1775,
            discountPercent: 47,
            discountedPrice: 940,
            displayIcon: `${MEDIA}/weaponskins/e86bf7e4-4dd3-fbee-533b-fa875344bbaf/displayicon.png`,
            displayName: "Ion Phantom",
            skinUuid: "e86bf7e4-4dd3-fbee-533b-fa875344bbaf",
            watched: true,
            weaponName: "Phantom",
          },
          {
            basePrice: 2175,
            discountPercent: 32,
            discountedPrice: 1479,
            displayIcon: `${MEDIA}/weaponskins/aecab890-43b7-d719-06bc-9295e3d116dc/displayicon.png`,
            displayName: "Reaver Operator",
            skinUuid: "aecab890-43b7-d719-06bc-9295e3d116dc",
            watched: false,
            weaponName: "Operator",
          },
          {
            basePrice: 875,
            discountPercent: 15,
            discountedPrice: 744,
            displayIcon: null,
            displayName: "Catalog update pending",
            skinUuid: null,
            watched: false,
            weaponName: null,
          },
        ],
          }
        : null,
      offers: [
        offer(
          "Prime Vandal",
          "b9ee2457-481c-6776-3f5b-0ca8e8f90c89",
          "b9ee2457-481c-6776-3f5b-0ca8e8f90c89",
          1775,
          "Premium Edition",
          "Vandal",
          true,
        ),
        offer(
          "Ion Sheriff",
          "83778c03-45a3-67a2-3c89-6b8598327d58",
          "83778c03-45a3-67a2-3c89-6b8598327d58",
          1275,
          "Select Edition",
          "Sheriff",
        ),
        offer(
          "Reaver Karambit",
          "b73d7b16-4652-bc5b-5c4c-068aabb19d0a",
          "b73d7b16-4652-bc5b-5c4c-068aabb19d0a",
          4350,
          "Ultra Edition",
          "Melee",
        ),
        offer(
          "Reaver Vandal",
          "30388628-42f0-606c-82c0-73ad43de997f",
          "30388628-42f0-606c-82c0-73ad43de997f",
          1775,
          "Exclusive Edition",
          "Vandal",
        ),
      ],
      rotationDate: storeDate,
    },
  ];
}

export function previewInventory(): readonly InventoryTileView[] {
  const weapon = (
    displayName: string,
    weaponUuid: string,
    categoryLabel: string,
    categoryOrdinal: number,
    watchedCount: number,
    watchedSkinName: string | null,
  ): InventoryTileView => ({
    artSource: watchedSkinName ? "watched-skin" : "weapon-default",
    categoryLabel,
    categoryOrdinal,
    displayIcon: null,
    displayName,
    watchedCount,
    watchedSkinName,
    weaponUuid,
  });

  return [
    weapon("Vandal", "9c82e19d-4575-0200-1a81-3eacf00cf872", "Rifles", 1, 3, "Prime Vandal"),
    weapon("Phantom", "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", "Rifles", 1, 1, "Ion Phantom"),
    weapon("Operator", "a03b24d3-4319-996d-0f8c-94bbfba1dfc7", "Sniper Rifles", 2, 0, null),
    weapon("Sheriff", "e336c6b8-418d-9340-d77f-7a9e4cfe0702", "Sidearms", 3, 1, "Ion Sheriff"),
  ];
}
