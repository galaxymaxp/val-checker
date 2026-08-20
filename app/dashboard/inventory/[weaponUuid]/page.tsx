import { notFound, redirect } from "next/navigation";

import { SkinSearchGrid } from "@/app/dashboard/_components/skin-search-grid";
import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import { setSkinWatched } from "@/app/dashboard/actions";
import { loadWeaponSkins } from "@/src/lib/catalog/weapon-detail";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { WeaponSkinsView } from "@/src/types/catalog-view";

// No weapon in the catalog comes close to this, so the list is complete in one
// read and the browser filter always searches every skin, not a page of them.
const MAX_SKINS = 500;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WeaponInventoryPageProps {
  readonly params: Promise<{ weaponUuid: string }>;
}

export default async function WeaponInventoryPage({
  params,
}: WeaponInventoryPageProps) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const { weaponUuid } = await params;

  if (!UUID_PATTERN.test(weaponUuid)) {
    notFound();
  }

  let view: WeaponSkinsView;

  try {
    view = await loadWeaponSkins(
      supabase,
      weaponUuid,
      { limit: MAX_SKINS, offset: 0 },
      data.claims.sub,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The weapon could not be found."
    ) {
      notFound();
    }

    throw error;
  }

  return (
    <main className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <TransitionLink
          className="w-fit text-sm text-ink-dim! no-underline transition-colors hocus:text-ink!"
          href="/dashboard"
        >
          ← Arsenal
        </TransitionLink>
        <h1>{view.weaponName}</h1>
        <p className="text-sm text-ink-muted">
          {view.total} {view.total === 1 ? "skin" : "skins"} in the catalog
        </p>
      </header>

      {view.skins.length === 0 ? (
        <p className="text-ink-muted">
          This weapon has no skins in the catalog yet.
        </p>
      ) : (
        <SkinSearchGrid
          skins={view.skins}
          updateWatch={setSkinWatched}
          weaponName={view.weaponName}
          weaponUuid={view.weaponUuid}
        />
      )}
    </main>
  );
}
