-- The first road route of a delivery, kept for the deviation report. Nullable, no default: additive and old-code safe.
ALTER TABLE "livraison" ADD COLUMN "route_planifiee" JSONB;
