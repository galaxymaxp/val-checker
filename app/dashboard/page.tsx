import { redirect } from "next/navigation";

import { DailyShopStage } from "@/app/dashboard/_components/daily-shop-stage";
import { FeaturedBundle } from "@/app/dashboard/_components/featured-bundle";
import { InventoryGrid } from "@/app/dashboard/_components/inventory-grid";
import { NightMarket } from "@/app/dashboard/_components/night-market";
import { RiotAccountSwitcher } from "@/app/dashboard/riot-account-switcher";
import { refreshRiotStorefront } from "@/app/dashboard/riot-actions";
import { StoreAttentionPanel } from "@/app/dashboard/store-attention-panel";
import { loadWishlistInventory } from "@/src/lib/catalog/inventory";
import { loadRiotAccountsWithClient } from "@/src/lib/riot/connection-state";
import { loadStorefrontDashboardStatus } from "@/src/lib/storefront/dashboard-status";
import { loadDailyShops } from "@/src/lib/storefront/daily-shop";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function DashboardPage({
  searchParams = Promise.resolve({}),
}: {
  readonly searchParams?: Promise<{ readonly account?: string }>;
} = {}) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const adminSupabase = createAdminSupabaseClient();
  const accountsPromise = loadRiotAccountsWithClient(
    adminSupabase,
    data.claims.sub,
  );
  const refreshStatusPromise = accountsPromise.then((accounts) =>
    loadStorefrontDashboardStatus(adminSupabase, data.claims.sub, accounts),
  );
  const [accounts, dailyShops, refreshStatus, tiles, params] = await Promise.all([
    accountsPromise,
    loadDailyShops(adminSupabase, data.claims.sub),
    refreshStatusPromise,
    loadWishlistInventory(supabase, data.claims.sub),
    searchParams,
  ]);
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
      {selectedAccount && selectedRefreshStatus ? (
        <StoreAttentionPanel
          account={selectedAccount}
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
      {selectedShop?.nightMarket ? (
        <NightMarket nightMarket={selectedShop.nightMarket} />
      ) : null}
      <InventoryGrid tiles={tiles} />
      {selectedShop?.bundle ? <FeaturedBundle bundle={selectedShop.bundle} /> : null}
    </main>
  );
}
