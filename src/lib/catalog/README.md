# Catalog boundary

`valorant-api.ts` is the only public API boundary for catalog data. It validates the
weapons payload before converting it to database-shaped weapon, skin, and skin-level rows.

The SkinLevel-to-Skin resolver is intentionally deferred to build-spec task 2.3.
