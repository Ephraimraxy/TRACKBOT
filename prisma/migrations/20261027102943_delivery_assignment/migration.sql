-- CreateTable
CREATE TABLE "livraison" (
    "id" VARCHAR(25) NOT NULL,
    "commande_id" VARCHAR(25) NOT NULL,
    "livreur_id" VARCHAR(25) NOT NULL,
    "assigne_par_id" VARCHAR(25),
    "date_assignation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livraison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "livraison_commande_id_key" ON "livraison"("commande_id");

-- CreateIndex
CREATE INDEX "index_livraison_livreur_id" ON "livraison"("livreur_id");

-- AddForeignKey
ALTER TABLE "livraison" ADD CONSTRAINT "livraison_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commande"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "livraison" ADD CONSTRAINT "livraison_livreur_id_fkey" FOREIGN KEY ("livreur_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "livraison" ADD CONSTRAINT "livraison_assigne_par_id_fkey" FOREIGN KEY ("assigne_par_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
