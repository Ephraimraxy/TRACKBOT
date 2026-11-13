-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommandeStatut" ADD VALUE 'EN_PREPARATION';
ALTER TYPE "CommandeStatut" ADD VALUE 'EN_LIVRAISON';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'LIVREUR';

-- CreateTable
CREATE TABLE "historique_statut_commande" (
    "id" VARCHAR(25) NOT NULL,
    "commande_id" VARCHAR(25) NOT NULL,
    "ancien_statut" "CommandeStatut",
    "nouveau_statut" "CommandeStatut" NOT NULL,
    "modifie_par_id" VARCHAR(25),
    "note" VARCHAR(255),
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_statut_commande_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_historique_commande_date" ON "historique_statut_commande"("commande_id", "date");

-- AddForeignKey
ALTER TABLE "historique_statut_commande" ADD CONSTRAINT "historique_statut_commande_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commande"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "historique_statut_commande" ADD CONSTRAINT "historique_statut_commande_modifie_par_id_fkey" FOREIGN KEY ("modifie_par_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill: give every existing order a starting history entry reflecting its current status.
INSERT INTO "historique_statut_commande" ("id", "commande_id", "ancien_statut", "nouveau_statut", "note", "date")
SELECT 'bf' || substr(md5(c."id"), 1, 20), c."id", NULL, c."statut", 'Historique initial (migration)', c."date"
FROM "commande" c;
