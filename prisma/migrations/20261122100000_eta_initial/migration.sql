-- The first time estimate of each delivery, kept for the owner's estimate-accuracy statistics. Three nullable columns: additive.
-- AlterTable
ALTER TABLE "livraison" ADD COLUMN     "eta_initiale_at" TIMESTAMP(3),
ADD COLUMN     "eta_initiale_secondes" INTEGER,
ADD COLUMN     "eta_initiale_source" VARCHAR(10);

