import { redirect } from "next/navigation";

import { setSkinWatched } from "@/app/dashboard/actions";
import { CollectionBrowser } from "@/app/dashboard/collection-browser";
import { disconnectRiotSession } from "@/app/dashboard/riot-actions";
import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";
import { loadCatalogForBrowse } from "@/src/lib/catalog/browse";
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

  const [weapons, watchedSkinUuids, riotConnectionState] = await Promise.all([
    loadCatalogForBrowse(supabase),
    loadWatchedSkinUuids(supabase),
    loadRiotConnectionStateWithClient(
      createAdminSupabaseClient(),
      data.claims.sub,
    ),
  ]);

  return (
    <main className="catalog-shell">
      <header className="catalog-hero">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h1>Find your next favorite.</h1>
        </div>
        <p className="lede">
          Browse every synced weapon skin and build a personal watch list. Riot account
          access is not involved.
        </p>
      </header>
      <RiotConnectionPanel
        disconnect={disconnectRiotSession}
        initialState={riotConnectionState}
      />
      <CollectionBrowser
        initialWatchedSkinUuids={watchedSkinUuids}
        updateWatch={setSkinWatched}
        weapons={weapons}
      />
    </main>
  );
}
