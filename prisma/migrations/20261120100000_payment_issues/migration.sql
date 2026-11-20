-- Payments the owner must look at (wrong amount, second payment, dispute, refund). A new table and two new types: nothing existing is changed.
-- CreateEnum
CREATE TYPE "PaymentIssueKind" AS ENUM ('AMOUNT_MISMATCH', 'DOUBLE_PAYMENT', 'DISPUTE', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "incident_paiement" (
    "id" VARCHAR(25) NOT NULL,
    "commande_id" VARCHAR(25) NOT NULL,
    "kind" "PaymentIssueKind" NOT NULL,
    "status" "PaymentIssueStatus" NOT NULL DEFAULT 'OPEN',
    "reference" VARCHAR(100) NOT NULL,
    "amount_paid_kobo" INTEGER,
    "expected_kobo" INTEGER,
    "currency" VARCHAR(8),
    "note" VARCHAR(500) NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_resolution" TIMESTAMP(3),
    "resolution_note" VARCHAR(500),

    CONSTRAINT "incident_paiement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_payment_issue_status" ON "incident_paiement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "unique_payment_issue_reference_kind" ON "incident_paiement"("reference", "kind");

-- AddForeignKey
ALTER TABLE "incident_paiement" ADD CONSTRAINT "incident_paiement_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commande"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

