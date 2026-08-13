# Catalog boundary

`valorant-api.ts` is the only public API boundary for catalog data. It validates the
weapons payload before converting it to database-shaped weapon, skin, and skin-level rows.

`resolve-skin-uuids.ts` is the load-bearing boundary between storefront SkinLevel UUIDs
and watchlist Skin UUIDs. Unknown levels are surfaced as `UnknownSkinLevelsError`.
