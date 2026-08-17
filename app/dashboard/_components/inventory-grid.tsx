import { InventoryTile } from "@/app/dashboard/_components/inventory-tile";
import { INVENTORY_CATEGORIES } from "@/src/lib/catalog/weapon-categories";
import type { InventoryTileView } from "@/src/types/catalog-view";

interface InventoryGridProps {
  readonly tiles: readonly InventoryTileView[];
}

function categoryId(label: string) {
  return `arsenal-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * The collection-screen grid: one column of tiles per weapon class, in the
 * game's section order. Sits over the pinned daily-shop stage (relative z-10
 * with an opaque background) so it slides across it on scroll.
 */
export function InventoryGrid({ tiles }: InventoryGridProps) {
  const tilesByCategory = new Map<string, InventoryTileView[]>();

  for (const tile of tiles) {
    const group = tilesByCategory.get(tile.categoryLabel) ?? [];
    group.push(tile);
    tilesByCategory.set(tile.categoryLabel, group);
  }

  const categories = INVENTORY_CATEGORIES.filter((label) =>
    tilesByCategory.has(label),
  );

  return (
    <section
      aria-label="Your arsenal"
      className="relative min-h-dvh scroll-mt-20 rounded-panel border border-line bg-bg-card px-4 py-12 shadow-panel sm:px-6 sm:py-16"
      id="watchlist"
    >
      <header className="mx-auto mb-12 flex max-w-3xl flex-col items-center gap-2 text-center">
        <p className="text-xs font-semibold tracking-widest text-ink-dim">
          YOUR ARSENAL
        </p>
        <h2>The collection, at a glance.</h2>
        <p className="text-sm text-ink-muted">
          Tiles show your newest watched skin for each weapon.
        </p>
      </header>

      <div className="mx-auto grid max-w-page gap-8 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {categories.map((label) => (
          <section
            aria-labelledby={categoryId(label)}
            className="flex flex-col gap-3"
            key={label}
          >
            <h3
              className="text-xs! tracking-[0.25em]! text-ink-dim"
              id={categoryId(label)}
            >
              {label}
            </h3>
            <ul className="flex flex-col gap-3" role="list">
              {(tilesByCategory.get(label) ?? []).map((tile) => (
                <li key={tile.weaponUuid}>
                  <InventoryTile tile={tile} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
