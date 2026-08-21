import { InventoryTile } from "@/app/dashboard/_components/inventory-tile";
import type { InventoryTileView } from "@/src/types/catalog-view";

interface InventoryGridProps {
  readonly tiles: readonly InventoryTileView[];
}

/**
 * The buy menu's own column grouping. VALORANT does not lay its weapons out in
 * one flat run: sidearms take a column, SMGs and shotguns share the next,
 * rifles take their own, and snipers sit above machine guns. Melee joins that
 * last column rather than taking one of its own: the buy menu's fifth column
 * is armour, which a watchlist has nothing to put there.
 */
const BUY_MENU_COLUMNS: readonly (readonly string[])[] = [
  ["SIDEARMS"],
  ["SMGS", "SHOTGUNS"],
  ["RIFLES"],
  ["SNIPER RIFLES", "MACHINE GUNS", "MELEE"],
];

function categoryId(label: string) {
  return `arsenal-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function InventoryGrid({ tiles }: InventoryGridProps) {
  const tilesByCategory = new Map<string, InventoryTileView[]>();

  for (const tile of tiles) {
    const group = tilesByCategory.get(tile.categoryLabel) ?? [];
    group.push(tile);
    tilesByCategory.set(tile.categoryLabel, group);
  }

  // Any class the catalog gains that the buy menu does not place gets its own
  // column rather than disappearing from the arsenal.
  const placed = new Set(BUY_MENU_COLUMNS.flat());
  const columns: readonly (readonly string[])[] = [
    ...BUY_MENU_COLUMNS,
    ...[...tilesByCategory.keys()]
      .filter((label) => !placed.has(label))
      .map((label) => [label]),
  ];

  const visibleColumns = columns
    .map((column) => column.filter((label) => tilesByCategory.has(label)))
    .filter((column) => column.length > 0);

  return (
    <section
      aria-label="Your arsenal"
      className="relative scroll-mt-20 rounded-panel border border-line bg-bg-card px-4 py-10 shadow-panel sm:px-6 sm:py-12"
      id="watchlist"
    >
      <header className="mb-8 flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-widest text-ink-dim">
          YOUR ARSENAL
        </p>
        <h2 className="text-xl!">The collection, at a glance.</h2>
        <p className="text-sm text-ink-muted">
          Every weapon, grouped the way the buy menu groups them. Tiles show
          your newest watched skin.
        </p>
      </header>

      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4">
        {visibleColumns.map((column) => (
          <div className="flex flex-col gap-6" key={column.join("-")}>
            {column.map((label) => (
              <section
                aria-labelledby={categoryId(label)}
                className="flex flex-col gap-2"
                key={label}
              >
                <h3
                  className="text-[11px]! tracking-[0.22em]! text-ink-dim"
                  id={categoryId(label)}
                >
                  {label}
                </h3>
                <ul className="flex flex-col gap-2" role="list">
                  {(tilesByCategory.get(label) ?? []).map((tile) => (
                    <li key={tile.weaponUuid}>
                      <InventoryTile tile={tile} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
