/*
  Warnings:

  - The values [SUNDAY] on the enum `PaymentDay` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."WalletTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT', 'LOAN_PAYMENT', 'TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN');

-- CreateEnum
CREATE TYPE "public"."ExpenseCategory" AS ENUM ('COMBUSTIBLE', 'CONSUMO', 'REPARACIONES', 'OTROS');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."PaymentDay_new" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');
ALTER TABLE "public"."loans" ALTER COLUMN "paymentDay" TYPE "public"."PaymentDay_new" USING ("paymentDay"::text::"public"."PaymentDay_new");
ALTER TYPE "public"."PaymentDay" RENAME TO "PaymentDay_old";
ALTER TYPE "public"."PaymentDay_new" RENAME TO "PaymentDay";
DROP TYPE "public"."PaymentDay_old";
COMMIT;

-- AlterTable
ALTER TABLE "public"."loans" ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "public"."sub_loans" ADD COLUMN     "paymentHistory" JSONB;

-- CreateTable
CREATE TABLE "public"."wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."WalletTransactionType" NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "description" TEXT NOT NULL,
    "relatedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "subLoanId" TEXT NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."daily_closures" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "closureDate" TIMESTAMP(3) NOT NULL,
    "totalCollected" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "totalExpenses" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expenses" (
    "id" TEXT NOT NULL,
    "dailyClosureId" TEXT NOT NULL,
    "category" "public"."ExpenseCategory" NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "public"."wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closures_userId_closureDate_key" ON "public"."daily_closures"("userId", "closureDate");

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_subLoanId_fkey" FOREIGN KEY ("subLoanId") REFERENCES "public"."sub_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."daily_closures" ADD CONSTRAINT "daily_closures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_dailyClosureId_fkey" FOREIGN KEY ("dailyClosureId") REFERENCES "public"."daily_closures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
