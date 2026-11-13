-- Delivery destination as map coordinates (optional, set by the customer's pin)
ALTER TABLE "adresse" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- Live ETA and reminder bookkeeping on each delivery
ALTER TABLE "livraison" ADD COLUMN "eta_secondes" INTEGER,
ADD COLUMN "distance_metres" INTEGER,
ADD COLUMN "eta_mis_a_jour" TIMESTAMP(3),
ADD COLUMN "dernier_rappel" TIMESTAMP(3),
ADD COLUMN "alerte_proche_envoyee" BOOLEAN NOT NULL DEFAULT false;

-- Each customer's reminder settings
ALTER TABLE "user" ADD COLUMN "rappel_livraison_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "alerte_proche" BOOLEAN NOT NULL DEFAULT true;
