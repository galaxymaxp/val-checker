import { redirect } from "next/navigation";

import { DailyShopStage } from "@/app/dashboard/_components/daily-shop-stage";
import { EmptyRiotSkinShowcase } from "@/app/dashboard/_components/empty-riot-skin-showcase";
import { FeaturedBundle } from "@/app/dashboard/_components/featured-bundle";
import { InventoryGrid } from "@/app/dashboard/_components/inventory-grid";
import { NightMarket } from "@/app/dashboard/_components/night-market";
import { RiotAccountSwitcher } from "@/app/dashboard/riot-account-switcher";
import { refreshRiotStorefront } from "@/app/dashboard/riot-actions";
import { StoreAttentionPanel } from "@/app/dashboard/store-attention-panel";
import { isDevPreview } from "@/src/lib/dev/preview";
import {
  previewAccounts,
  previewDailyShops,
  previewInventory,
  previewRefreshStatus,
  previewShowcaseSkins,
} from "@/src/lib/dev/preview-data";
import { loadWishlistInventory } from "@/src/lib/catalog/inventory";
import { loadShowcaseSkins } from "@/src/lib/catalog/showcase";
import { loadRiotAccountsWithClient } from "@/src/lib/riot/connection-state";
import { loadStorefrontDashboardStatus } from "@/src/lib/storefront/dashboard-status";
import { loadDailyShops } from "@/src/lib/storefront/daily-shop";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { ShowcaseSkinView } from "@/src/types/catalog-view";

export default async function DashboardPage({
  searchParams = Promise.resolve({}),
}: {
  readonly searchParams?: Promise<{
    readonly account?: string;
    readonly refresh?: string;
  }>;
} = {}) {
  if (isDevPreview()) {
    return renderDashboard(await previewDashboardData(await searchParams));
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const params = await searchParams;
  const adminSupabase = createAdminSupabaseClient();
  const accountsPromise = loadRiotAccountsWithClient(
    adminSupabase,
    data.claims.sub,
  );
  const refreshStatusPromise = accountsPromise.then((accounts) =>
    loadStorefrontDashboardStatus(adminSupabase, data.claims.sub, accounts),
  );
  const accounts = await accountsPromise;
  const selectedAccount =
    accounts.find((account) => account.id === params.account) ?? accounts[0];
  const [dailyShops, refreshStatus, tiles, showcaseSkins] = await Promise.all([
    loadDailyShops(adminSupabase, data.claims.sub),
    refreshStatusPromise,
    loadWishlistInventory(
      supabase,
      data.claims.sub,
      selectedAccount?.id ?? null,
    ),
    // The showcase only exists for the no-account state, so a user with a
    // connected account never pays for the catalog read.
    accounts.length === 0
      ? loadShowcaseSkins(supabase)
      : Promise.resolve<readonly ShowcaseSkinView[]>([]),
  ]);

  return renderDashboard({
    accounts,
    dailyShops,
    params,
    refreshStatus,
    showcaseSkins,
    tiles,
  });
}

interface DashboardData {
  readonly accounts: Awaited<ReturnType<typeof loadRiotAccountsWithClient>>;
  readonly dailyShops: Awaited<ReturnType<typeof loadDailyShops>>;
  readonly params: { readonly account?: string; readonly refresh?: string };
  readonly refreshStatus: Awaited<
    ReturnType<typeof loadStorefrontDashboardStatus>
  >;
  readonly showcaseSkins: readonly ShowcaseSkinView[];
  readonly tiles: Awaited<ReturnType<typeof loadWishlistInventory>>;
}

/** Fixtures for `VAL_CHECKER_DEV_PREVIEW=1`; see src/lib/dev/preview.ts. */
async function previewDashboardData(params: {
  readonly account?: string;
  readonly refresh?: string;
}): Promise<DashboardData> {
  const now = new Date();
  return {
    accounts: previewAccounts(now),
    dailyShops: previewDailyShops(now),
    params,
    refreshStatus: previewRefreshStatus(now),
    showcaseSkins: previewShowcaseSkins(),
    tiles: previewInventory(),
  };
}

function renderDashboard({
  accounts,
  dailyShops,
  params,
  refreshStatus,
  showcaseSkins,
  tiles,
}: DashboardData) {
  const selectedAccount =
    accounts.find((account) => account.id === params.account) ?? accounts[0];
  const selectedShop = selectedAccount
    ? (dailyShops.find(
        (shop) => shop.connectionId === selectedAccount.id,
      ) ?? null)
    : null;
  const selectedRefreshStatus = selectedAccount
    ? refreshStatus.accounts.find(
        (status) => status.connectionId === selectedAccount.id,
      )
    : undefined;

  return (
    <main className="flex flex-col gap-6">
      <RiotAccountSwitcher
        accounts={accounts}
        selectedConnectionId={selectedAccount?.id ?? null}
      />
      {/* Same condition the switcher's empty state uses, so the showcase can
          never outlive the "connect your first account" card it supports. */}
      {accounts.length === 0 ? (
        <EmptyRiotSkinShowcase skins={showcaseSkins} />
      ) : null}
      {selectedAccount && selectedRefreshStatus ? (
        <StoreAttentionPanel
          account={selectedAccount}
          force={params.refresh === "1"}
          refreshStatus={selectedRefreshStatus}
          refreshStore={refreshRiotStorefront}
          shop={selectedShop}
          storeDate={refreshStatus.storeDate}
        />
      ) : null}
      {selectedAccount ? (
        <DailyShopStage
          accountLabel={selectedAccount.label}
          connected={selectedAccount.authStatus === "CONNECTED"}
          shop={selectedShop}
        />
      ) : null}
      {/* Store content stays together and above the collection: today's
          offers, then anything else the store is running right now. The
          bundle below the watchlist read as an afterthought, two screens
          down from the store it belongs to. */}
      {selectedShop?.nightMarket ? (
        <NightMarket nightMarket={selectedShop.nightMarket} />
      ) : null}
      {selectedShop?.bundle ? <FeaturedBundle bundle={selectedShop.bundle} /> : null}
      <InventoryGrid
        connectionId={selectedAccount?.id ?? null}
        tiles={tiles}
      />
    </main>
  );
}
