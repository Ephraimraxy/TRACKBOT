-- Real payments through Paystack: remember which transaction paid an order, and how.
ALTER TABLE "paiement_commande" ADD COLUMN "reference" VARCHAR(100),
ADD COLUMN "canal" VARCHAR(30),
ADD COLUMN "date_paiement" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "paiement_commande_reference_key" ON "paiement_commande"("reference");
