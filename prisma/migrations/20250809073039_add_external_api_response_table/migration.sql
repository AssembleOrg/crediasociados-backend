/*
  Warnings:

  - You are about to drop the column `referenceId` on the `transactions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."clients" ADD COLUMN     "job" TEXT;

-- AlterTable
ALTER TABLE "public"."transactions" DROP COLUMN "referenceId",
ADD COLUMN     "subLoanId" TEXT;

-- CreateTable
CREATE TABLE "public"."external_api_responses" (
    "id" TEXT NOT NULL,
    "compra" DECIMAL(10,2) NOT NULL,
    "venta" DECIMAL(10,2) NOT NULL,
    "casa" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "moneda" TEXT NOT NULL,
    "fechaActualizacion" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "responseTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_api_responses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_subLoanId_fkey" FOREIGN KEY ("subLoanId") REFERENCES "public"."sub_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
