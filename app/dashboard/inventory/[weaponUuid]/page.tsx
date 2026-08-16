import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SkinCard } from "@/app/dashboard/_components/skin-card";
import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import { setSkinWatched } from "@/app/dashboard/actions";
import { loadWeaponSkins } from "@/src/lib/catalog/weapon-detail";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { WeaponSkinsView } from "@/src/types/catalog-view";

const PAGE_SIZE = 48;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WeaponInventoryPageProps {
  readonly params: Promise<{ weaponUuid: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WeaponInventoryPage({
  params,
  searchParams,
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

  const parameters = await searchParams;
  const parsedPage = Number.parseInt(firstValue(parameters.page) ?? "", 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  let view: WeaponSkinsView;

  try {
    view = await loadWeaponSkins(
      supabase,
      weaponUuid,
      { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
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
        <p className="text-ink-muted">There are no skins on this page.</p>
      ) : (
        <ul
          className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
          role="list"
        >
          {view.skins.map((skin) => (
            <li
              className="[contain-intrinsic-size:0_220px] [content-visibility:auto]"
              key={skin.skinUuid}
            >
              <SkinCard
                skin={skin}
                updateWatch={setSkinWatched}
                weaponUuid={view.weaponUuid}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="flex items-center gap-4 text-sm">
        {page > 1 ? (
          <Link href={`/dashboard/inventory/${weaponUuid}?page=${page - 1}`}>
            Previous
          </Link>
        ) : null}
        <span className="text-ink-dim">Page {page}</span>
        {view.hasMore ? (
          <Link href={`/dashboard/inventory/${weaponUuid}?page=${page + 1}`}>
            Next
          </Link>
        ) : null}
      </footer>
    </main>
  );
}
