import { InventoryTile } from "@/app/dashboard/_components/inventory-tile";
import type { InventoryTileView } from "@/src/types/catalog-view";

interface InventoryGridProps {
  readonly connectionId: string | null;
  readonly tiles: readonly InventoryTileView[];
}

/**
 * The buy menu's column grouping: sidearms take a column, SMGs sit above
 * shotguns, rifles take their own, and snipers, machine guns and melee share
 * the last.
 *
 * The classes are uneven -- six sidearms against one melee -- so the columns
 * are justified rather than left to end wherever they run out: every column is
 * the same width, all of them stretch to the tallest, and the slack is spread
 * between groups instead of pooling as dead space at the bottom of the short
 * ones.
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

export function InventoryGrid({ connectionId, tiles }: InventoryGridProps) {
  const tilesByCategory = new Map<string, InventoryTileView[]>();

  for (const tile of tiles) {
    const group = tilesByCategory.get(tile.categoryLabel) ?? [];
    group.push(tile);
    tilesByCategory.set(tile.categoryLabel, group);
  }

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

      {/* items-stretch: columns share the tallest height so none stops short. */}
      <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 md:grid-cols-4">
        {visibleColumns.map((column) => (
          <div
            className="flex h-full flex-col justify-between gap-4"
            key={column.join("-")}
          >
            {column.map((label) => (
              <section
                aria-labelledby={categoryId(label)}
                className="flex flex-1 flex-col gap-2"
                key={label}
              >
                <h3
                  className="text-[11px]! tracking-[0.22em]! text-ink-dim"
                  id={categoryId(label)}
                >
                  {label}
                </h3>
                {/* Tiles absorb the slack by growing, the way the buy menu's
                    own columns do -- its sidearm cells are shorter than its
                    rifle cells, and every column still ends on one line. */}
                <ul className="flex flex-1 flex-col gap-2" role="list">
                  {(tilesByCategory.get(label) ?? []).map((tile) => (
                    <li className="flex flex-1" key={tile.weaponUuid}>
                      <InventoryTile connectionId={connectionId} tile={tile} />
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
