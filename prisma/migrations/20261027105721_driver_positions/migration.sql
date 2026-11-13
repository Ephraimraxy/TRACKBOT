-- CreateTable
CREATE TABLE "position_livraison" (
    "id" VARCHAR(25) NOT NULL,
    "commande_id" VARCHAR(25) NOT NULL,
    "livreur_id" VARCHAR(25) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "precision" DOUBLE PRECISION,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_livraison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_position_commande_date" ON "position_livraison"("commande_id", "date");

-- AddForeignKey
ALTER TABLE "position_livraison" ADD CONSTRAINT "position_livraison_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commande"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_livraison" ADD CONSTRAINT "position_livraison_livreur_id_fkey" FOREIGN KEY ("livreur_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
