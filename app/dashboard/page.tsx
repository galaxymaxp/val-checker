import { redirect } from "next/navigation";

import { setSkinWatched, signOut } from "@/app/dashboard/actions";
import { CollectionBrowser } from "@/app/dashboard/collection-browser";
import { DailyShopPanel } from "@/app/dashboard/daily-shop-panel";
import {
  checkDailyShopNow,
  connectRiotCredentials,
  connectRiotSession,
  disconnectRiotSession,
  submitRiotMfaCode,
} from "@/app/dashboard/riot-actions";
import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";
import { loadCatalogForBrowse } from "@/src/lib/catalog/browse";
import { loadDailyShop } from "@/src/lib/storefront/daily-shop";
import { canRiotConnect, isRiotAdmin } from "@/src/lib/riot/connect-allowlist";
import { loadRiotConnectionStateWithClient } from "@/src/lib/riot/connection-state";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { loadWatchedSkinUuids } from "@/src/lib/watchlist/load";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const riotIdentity = {
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    userId: data.claims.sub,
  };
  const riotConnectAllowed = canRiotConnect(riotIdentity);
  // The raw cookie-jar paste is an admin-only fallback (Version 2.4).
  const riotJarPasteAllowed = riotConnectAllowed && isRiotAdmin(riotIdentity);

  const adminSupabase = createAdminSupabaseClient();
  const [weapons, watchedSkinUuids, riotConnectionState, dailyShop] =
    await Promise.all([
      loadCatalogForBrowse(supabase),
      loadWatchedSkinUuids(supabase),
      loadRiotConnectionStateWithClient(adminSupabase, data.claims.sub),
      loadDailyShop(adminSupabase, data.claims.sub),
    ]);

  return (
    <main className="catalog-shell">
      <header className="catalog-hero">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h1>Find your next favorite.</h1>
          <p className="lede">
            Watch any skin and get an email the morning it lands in your store.
          </p>
        </div>
        <div className="session-bar">
          <span>
            Signed in as{" "}
            <strong>
              {typeof data.claims.email === "string" ? data.claims.email : "your account"}
            </strong>
          </span>
          <form action={signOut}>
            <button className="sign-out-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <DailyShopPanel
        checkNow={riotConnectAllowed ? checkDailyShopNow : undefined}
        connected={riotConnectionState === "connected"}
        shop={dailyShop}
        todaysRotation={new Date().toISOString().slice(0, 10)}
      />
      <RiotConnectionPanel
        connectAllowed={riotConnectAllowed}
        connectCredentials={
          riotConnectAllowed ? connectRiotCredentials : undefined
        }
        connectSession={riotJarPasteAllowed ? connectRiotSession : undefined}
        disconnect={disconnectRiotSession}
        initialState={riotConnectionState}
        submitMfaCode={riotConnectAllowed ? submitRiotMfaCode : undefined}
      />
      <CollectionBrowser
        initialWatchedSkinUuids={watchedSkinUuids}
        updateWatch={setSkinWatched}
        weapons={weapons}
      />
    </main>
  );
}
