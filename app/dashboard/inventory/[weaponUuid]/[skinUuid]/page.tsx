import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { ChromaShowcase } from "@/app/dashboard/_components/chroma-showcase";
import { LevelVideo } from "@/app/dashboard/_components/level-video";
import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import { loadSkinDetail } from "@/src/lib/catalog/skin-detail";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { SkinDetailView } from "@/src/types/catalog-view";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Human labels for the upstream upgrade kinds worth naming. */
const LEVEL_ITEM_LABELS: Readonly<Record<string, string>> = {
  Animation: "Animation",
  Finisher: "Finisher",
  KillCounter: "Kill Counter",
  VFX: "VFX",
};

/** "EEquipmentSkinLevelItem::KillCounter" → "Kill Counter". */
function levelItemLabel(levelItem: string | null): string | null {
  if (!levelItem) {
    return null;
  }

  const suffix = levelItem.split("::").at(-1) ?? levelItem;

  return (
    LEVEL_ITEM_LABELS[suffix] ?? suffix.replaceAll(/([a-z])([A-Z])/g, "$1 $2")
  );
}

interface SkinDetailPageProps {
  readonly params: Promise<{ skinUuid: string; weaponUuid: string }>;
}

export default async function SkinDetailPage({ params }: SkinDetailPageProps) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard");
  }

  const { skinUuid, weaponUuid } = await params;

  if (!UUID_PATTERN.test(weaponUuid) || !UUID_PATTERN.test(skinUuid)) {
    notFound();
  }

  let view: SkinDetailView;

  try {
    view = await loadSkinDetail(supabase, skinUuid);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The skin could not be found."
    ) {
      notFound();
    }

    throw error;
  }

  const tierColor = view.tier?.highlightColor
    ? `#${view.tier.highlightColor}`
    : undefined;

  return (
    <main className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <TransitionLink
          className="w-fit text-sm text-ink-dim! no-underline transition-colors hocus:text-ink!"
          href={`/dashboard/inventory/${view.weaponUuid}`}
        >
          ← {view.weaponName}
        </TransitionLink>

        {view.tier ? (
          <p
            className="flex w-fit items-center gap-2 rounded-full bg-bg-inset px-3 py-1 text-[11px] tracking-wider text-ink-muted uppercase"
            style={
              tierColor
                ? {
                    backgroundColor: `color-mix(in srgb, ${tierColor} 18%, transparent)`,
                  }
                : undefined
            }
          >
            {view.tier.displayIcon ? (
              <Image
                alt=""
                height={16}
                src={view.tier.displayIcon}
                width={16}
              />
            ) : null}
            {view.tier.displayName}
          </p>
        ) : null}

        <h1 className="text-4xl! font-semibold tracking-tight md:text-5xl!">
          {view.displayName}
        </h1>
      </header>

      <ChromaShowcase
        chromas={view.chromas}
        fallbackRender={view.fullRender}
        skinUuid={view.skinUuid}
        tierColor={view.tier?.highlightColor ?? null}
      />

      {view.levels.length > 0 ? (
        <section aria-labelledby="levels-heading" className="flex flex-col gap-3">
          <h2 className="text-xs! tracking-[0.25em] text-ink-dim" id="levels-heading">
            LEVELS
          </h2>
          <ul className="grid gap-3" role="list">
            {view.levels.map((level) => {
              const name = level.displayName ?? `Level ${level.ordinal + 1}`;
              const chip = levelItemLabel(level.levelItem);

              return (
                <li
                  className="flex flex-col gap-3 rounded-card border border-line bg-bg-card p-4"
                  key={level.levelUuid}
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-inset text-xs font-semibold text-ink-muted"
                    >
                      {level.ordinal + 1}
                    </span>
                    <p className="text-sm font-medium">{name}</p>
                    {chip ? (
                      <span className="rounded-full bg-bg-inset px-2 py-0.5 text-[10px] tracking-wider text-ink-muted uppercase">
                        {chip}
                      </span>
                    ) : null}
                  </div>

                  {level.streamedVideo ? (
                    <LevelVideo
                      poster={level.displayIcon}
                      src={level.streamedVideo}
                      title={`${name} preview`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {view.levels.length === 0 && view.chromas.length === 0 ? (
        <p className="text-ink-dim">
          Level and variant data will appear after the next catalog sync.
        </p>
      ) : null}
    </main>
  );
}
