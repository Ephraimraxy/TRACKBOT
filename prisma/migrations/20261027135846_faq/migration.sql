-- CreateTable
CREATE TABLE "faq" (
    "id" VARCHAR(25) NOT NULL,
    "question" VARCHAR(255) NOT NULL,
    "answer" VARCHAR(1000) NOT NULL,
    "keywords" VARCHAR(255),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_modification" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_faq_actif" ON "faq"("actif");
