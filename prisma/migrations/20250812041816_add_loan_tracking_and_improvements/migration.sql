/*
  Warnings:

  - Added the required column `originalAmount` to the `loans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."external_api_responses" ALTER COLUMN "compra" SET DATA TYPE DECIMAL(20,2),
ALTER COLUMN "venta" SET DATA TYPE DECIMAL(20,2);

-- AlterTable
ALTER TABLE "public"."loans" ADD COLUMN     "originalAmount" DECIMAL(40,2) NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(40,2);

-- AlterTable
ALTER TABLE "public"."sub_loans" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(40,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(40,2),
ALTER COLUMN "paidAmount" SET DATA TYPE DECIMAL(40,2);

-- AlterTable
ALTER TABLE "public"."transactions" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(40,2);
