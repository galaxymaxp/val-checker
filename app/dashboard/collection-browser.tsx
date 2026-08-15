"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import type { CatalogWeaponView } from "@/src/lib/catalog/browse";
import type { WatchMutationResult } from "@/src/types/watchlist";

interface CollectionBrowserProps {
  readonly initialWatchedSkinUuids: readonly string[];
  readonly updateWatch: (
    skinUuid: string,
    watched: boolean,
  ) => Promise<WatchMutationResult>;
  readonly weapons: readonly CatalogWeaponView[];
}

export function CollectionBrowser({
  initialWatchedSkinUuids,
  updateWatch,
  weapons,
}: CollectionBrowserProps) {
  const [query, setQuery] = useState("");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [watchedSkinUuids, setWatchedSkinUuids] = useState<Set<string>>(
    () => new Set(initialWatchedSkinUuids),
  );
  const [pendingSkinUuids, setPendingSkinUuids] = useState<Set<string>>(
    () => new Set(),
  );
  const [mutationError, setMutationError] = useState<string>();
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const categories = useMemo(() => {
    const grouped = new Map<string, CatalogWeaponView[]>();

    for (const weapon of weapons) {
      const weaponMatches = [weapon.displayName, weapon.category].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
      const skins = weapon.skins.filter((skin) => {
        const searchMatches =
          !normalizedQuery ||
          weaponMatches ||
          skin.displayName.toLocaleLowerCase().includes(normalizedQuery);
        const watchMatches = !watchedOnly || watchedSkinUuids.has(skin.skinUuid);
        return searchMatches && watchMatches;
      });

      if (skins.length === 0) {
        continue;
      }

      const categoryWeapons = grouped.get(weapon.category) ?? [];
      categoryWeapons.push({ ...weapon, skins });
      grouped.set(weapon.category, categoryWeapons);
    }

    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [normalizedQuery, watchedOnly, watchedSkinUuids, weapons]);

  async function toggleWatched(skinUuid: string) {
    if (pendingSkinUuids.has(skinUuid)) {
      return;
    }

    const wasWatched = watchedSkinUuids.has(skinUuid);
    const nextWatched = !wasWatched;
    setMutationError(undefined);
    setWatchedSkinUuids((current) => {
      const next = new Set(current);

      if (wasWatched) {
        next.delete(skinUuid);
      } else {
        next.add(skinUuid);
      }

      return next;
    });
    setPendingSkinUuids((current) => new Set(current).add(skinUuid));

    try {
      const result = await updateWatch(skinUuid, nextWatched);

      if (!result.ok) {
        throw new Error(result.error);
      }
    } catch {
      setWatchedSkinUuids((current) => {
        const rolledBack = new Set(current);

        if (wasWatched) {
          rolledBack.add(skinUuid);
        } else {
          rolledBack.delete(skinUuid);
        }

        return rolledBack;
      });
      setMutationError("That change did not save. Your previous watchlist was restored.");
    } finally {
      setPendingSkinUuids((current) => {
        const next = new Set(current);
        next.delete(skinUuid);
        return next;
      });
    }
  }

  return (
    <section aria-label="Skin catalog" className="collection-browser">
      <div className="collection-controls">
        <label className="search-field" htmlFor="catalog-search">
          <span>Search the collection</span>
          <input
            id="catalog-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Weapon, category, or skin"
            type="search"
            value={query}
          />
        </label>
        <div aria-label="Collection filter" className="filter-switch" role="group">
          <button
            aria-pressed={!watchedOnly}
            onClick={() => setWatchedOnly(false)}
            type="button"
          >
            All
          </button>
          <button
            aria-pressed={watchedOnly}
            onClick={() => setWatchedOnly(true)}
            type="button"
          >
            Watched only
          </button>
        </div>
      </div>

      {mutationError ? (
        <p className="watchlist-error" role="alert">
          {mutationError}
        </p>
      ) : null}

      {categories.length === 0 ? (
        <div className="empty-catalog" role="status">
          <p className="eyebrow">NO MATCHES</p>
          <h2>Nothing fits this filter.</h2>
          <p>Try a different search or switch back to the full collection.</p>
        </div>
      ) : (
        categories.map(([category, categoryWeapons]) => (
          <section className="category-section" key={category}>
            <div className="category-heading">
              <p className="eyebrow">WEAPON CLASS</p>
              <h2>{category}</h2>
            </div>
            <div className="weapon-grid">
              {categoryWeapons.map((weapon) => (
                <article className="weapon-card" key={weapon.weaponUuid}>
                  <header>
                    <h3>{weapon.displayName}</h3>
                    <p>{weapon.skins.length}</p>
                  </header>
                  <ul className="skin-grid">
                    {weapon.skins.map((skin) => {
                      const isWatched = watchedSkinUuids.has(skin.skinUuid);
                      const isPending = pendingSkinUuids.has(skin.skinUuid);

                      return (
                        <li className="skin-card" key={skin.skinUuid}>
                          <div className="skin-art">
                            {skin.displayIcon ? (
                              <Image
                                alt=""
                                fill
                                sizes="(max-width: 720px) 76vw, (max-width: 1200px) 38vw, 18vw"
                                src={skin.displayIcon}
                              />
                            ) : (
                              <span aria-hidden="true">V</span>
                            )}
                          </div>
                          <div className="skin-details">
                            <p>{skin.contentTier ? "Catalog skin" : "Standard edition"}</p>
                            <h4>{skin.displayName}</h4>
                            <button
                              aria-label={`${isWatched ? "Stop watching" : "Watch"} ${skin.displayName}`}
                              aria-pressed={isWatched}
                              className="watch-button"
                              disabled={isPending}
                              onClick={() => toggleWatched(skin.skinUuid)}
                              type="button"
                            >
                              {isPending ? "Saving…" : isWatched ? "Watched" : "Watch"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
