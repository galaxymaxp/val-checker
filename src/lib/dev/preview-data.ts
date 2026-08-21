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
        displayIcon: `${MEDIA}/bundles/d087f4fd-4942-d782-c76c-5e84dc307a66/displayicon2.png`,
        displayName: "Aeris",
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
    displayIcon: `${MEDIA}/weapons/${weaponUuid}/displayicon.png`,
    displayName,
    watchedCount,
    watchedSkinName,
    weaponUuid,
  });

  // The full buy-menu roster, so the arsenal layout can be judged locally
  // rather than from four placeholder tiles with no artwork.
  return [
    weapon(
      "Classic",
      "29a0cfab-485b-f5d5-779a-b59f85e204a8",
      "SIDEARMS",
      0,
      0,
      null,
    ),
    weapon(
      "Shorty",
      "42da8ccc-40d5-affc-beec-15aa47b42eda",
      "SIDEARMS",
      0,
      0,
      null,
    ),
    weapon(
      "Frenzy",
      "44d4e95c-4157-0037-81b2-17841bf2e8e3",
      "SIDEARMS",
      0,
      0,
      null,
    ),
    weapon(
      "Ghost",
      "1baa85b4-4c70-1284-64bb-6481dfc3bb4e",
      "SIDEARMS",
      0,
      0,
      null,
    ),
    weapon(
      "Sheriff",
      "e336c6b8-418d-9340-d77f-7a9e4cfe0702",
      "SIDEARMS",
      0,
      1,
      "Ion Sheriff",
    ),
    weapon(
      "Bandit",
      "410b2e0b-4ceb-1321-1727-20858f7f3477",
      "SIDEARMS",
      0,
      0,
      null,
    ),
    weapon(
      "Stinger",
      "f7e1b454-4ad4-1063-ec0a-159e56b58941",
      "SMGS",
      1,
      0,
      null,
    ),
    weapon(
      "Spectre",
      "462080d1-4035-2937-7c09-27aa2a5c27a7",
      "SMGS",
      1,
      0,
      null,
    ),
    weapon(
      "Bulldog",
      "ae3de142-4d85-2547-dd26-4e90bed35cf7",
      "RIFLES",
      2,
      0,
      null,
    ),
    weapon(
      "Guardian",
      "4ade7faa-4cf1-8376-95ef-39884480959b",
      "RIFLES",
      2,
      0,
      null,
    ),
    weapon(
      "Phantom",
      "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a",
      "RIFLES",
      2,
      1,
      "Ion Phantom",
    ),
    weapon(
      "Vandal",
      "9c82e19d-4575-0200-1a81-3eacf00cf872",
      "RIFLES",
      2,
      3,
      "Prime Vandal",
    ),
    weapon(
      "Marshal",
      "c4883e50-4494-202c-3ec3-6b8a9284f00b",
      "SNIPER RIFLES",
      3,
      0,
      null,
    ),
    weapon(
      "Outlaw",
      "5f0aaf7a-4289-3998-d5ff-eb9a5cf7ef5c",
      "SNIPER RIFLES",
      3,
      0,
      null,
    ),
    weapon(
      "Operator",
      "a03b24d3-4319-996d-0f8c-94bbfba1dfc7",
      "SNIPER RIFLES",
      3,
      1,
      "Reaver Operator",
    ),
    weapon(
      "Bucky",
      "910be174-449b-c412-ab22-d0873436b21b",
      "SHOTGUNS",
      4,
      0,
      null,
    ),
    weapon(
      "Judge",
      "ec845bf4-4f79-ddda-a3da-0db3774b2794",
      "SHOTGUNS",
      4,
      0,
      null,
    ),
    weapon(
      "Ares",
      "55d8a0f4-4274-ca67-fe2c-06ab45efdf58",
      "MACHINE GUNS",
      5,
      0,
      null,
    ),
    weapon(
      "Odin",
      "63e6c2b6-4a8e-869c-3d4c-e38355226584",
      "MACHINE GUNS",
      5,
      0,
      null,
    ),
    weapon(
      "Melee",
      "2f59173c-4bed-b6c3-2191-dea9b58be9c7",
      "MELEE",
      6,
      2,
      "Reaver Karambit",
    ),
  ];
}
