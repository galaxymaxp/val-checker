import { redirect } from "next/navigation";

import { DailyShopStage } from "@/app/dashboard/_components/daily-shop-stage";
import { InventoryGrid } from "@/app/dashboard/_components/inventory-grid";
import { checkDailyShopNow } from "@/app/dashboard/riot-actions";
import { loadWishlistInventory } from "@/src/lib/catalog/inventory";
import { canRiotConnect } from "@/src/lib/riot/connect-allowlist";
import { loadRiotConnectionStateWithClient } from "@/src/lib/riot/connection-state";
import { loadDailyShops } from "@/src/lib/storefront/daily-shop";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const riotConnectAllowed = canRiotConnect({
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    userId: data.claims.sub,
  });

  const adminSupabase = createAdminSupabaseClient();
  const [dailyShops, tiles, riotConnectionState] = await Promise.all([
    loadDailyShops(adminSupabase, data.claims.sub),
    loadWishlistInventory(supabase, data.claims.sub),
    loadRiotConnectionStateWithClient(adminSupabase, data.claims.sub),
  ]);

  return (
    <main>
      {/* One relative container holds both stages so the sticky shop has
          scroll travel: the stage pins at top-0 while the inventory grid
          (relative z-10, opaque background) slides up over it. */}
      <div className="relative">
        <DailyShopStage
          checkNow={riotConnectAllowed ? checkDailyShopNow : undefined}
          connected={riotConnectionState === "connected"}
          shops={dailyShops}
          todaysRotation={new Date().toISOString().slice(0, 10)}
        />
        <InventoryGrid tiles={tiles} />
      </div>
    </main>
  );
}
