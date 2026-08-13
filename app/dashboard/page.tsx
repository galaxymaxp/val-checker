import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  return (
    <main className="shell dashboard-shell">
      <p className="eyebrow">YOUR COLLECTION</p>
      <h1>Your dashboard is ready.</h1>
      <p className="lede">
        Your catalog and watchlist will appear here as the next phases are completed.
      </p>
    </main>
  );
}
