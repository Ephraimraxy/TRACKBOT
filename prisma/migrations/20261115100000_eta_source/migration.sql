-- Say whether a delivery's time left came from a road route or from a straight-line estimate.
-- Nullable and with no default: existing rows are unaffected, and the previous version of the application ignores it.
ALTER TABLE "livraison" ADD COLUMN "eta_source" VARCHAR(10);
