-- A GPS point now keeps when the phone captured it ("date", as before) and when the server stored it, and whether it
-- arrived late. Additive, with defaults: existing rows and the previous application version are unaffected.
ALTER TABLE "position_livraison" ADD COLUMN "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "position_livraison" ADD COLUMN "backfilled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "position_livraison" SET "received_at" = "date";
