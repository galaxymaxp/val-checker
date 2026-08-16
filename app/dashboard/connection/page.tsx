import { redirect } from "next/navigation";

import {
  connectRiotCredentials,
  connectRiotSession,
  disconnectRiotSession,
  submitRiotMfaCode,
} from "@/app/dashboard/riot-actions";
import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";
import { canRiotConnect, isRiotAdmin } from "@/src/lib/riot/connect-allowlist";
import { loadRiotConnectionStateWithClient } from "@/src/lib/riot/connection-state";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function RiotConnectionPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard/connection");
  }

  const riotIdentity = {
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    userId: data.claims.sub,
  };
  const riotConnectAllowed = canRiotConnect(riotIdentity);
  // The raw cookie-jar paste is an admin-only fallback (Version 2.4).
  const riotJarPasteAllowed = riotConnectAllowed && isRiotAdmin(riotIdentity);

  const riotConnectionState = await loadRiotConnectionStateWithClient(
    createAdminSupabaseClient(),
    data.claims.sub,
  );

  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">RIOT CONNECTION</p>
        <h1>Link your Riot account.</h1>
        <p className="lede">
          Riot sessions expire, so you will need to reconnect from time to
          time. This service is unaffiliated with Riot Games.
        </p>
      </header>
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
    </main>
  );
}
