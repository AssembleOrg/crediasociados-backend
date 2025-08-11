/*
  Warnings:

  - You are about to drop the column `dueDate` on the `loans` table. All the data in the column will be lost.
  - You are about to drop the column `interestRate` on the `loans` table. All the data in the column will be lost.
  - You are about to drop the column `term` on the `loans` table. All the data in the column will be lost.
  - Added the required column `baseInterestRate` to the `loans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentFrequency` to the `loans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `penaltyInterestRate` to the `loans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPayments` to the `loans` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."Currency" AS ENUM ('ARS', 'USD');

-- CreateEnum
CREATE TYPE "public"."PaymentFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "public"."PaymentDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "public"."SubLoanStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'PARTIAL');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable
ALTER TABLE "public"."loans" DROP COLUMN "dueDate",
DROP COLUMN "interestRate",
DROP COLUMN "term",
ADD COLUMN     "baseInterestRate" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
ADD COLUMN     "firstDueDate" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentDay" "public"."PaymentDay",
ADD COLUMN     "paymentFrequency" "public"."PaymentFrequency" NOT NULL,
ADD COLUMN     "penaltyInterestRate" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "totalPayments" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "public"."sub_loans" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "paymentNumber" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "status" "public"."SubLoanStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "daysOverdue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sub_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."transactions" (
    "id" TEXT NOT NULL,
    "loanId" TEXT,
    "clientId" TEXT,
    "type" "public"."TransactionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sub_loans_loanId_paymentNumber_key" ON "public"."sub_loans"("loanId", "paymentNumber");

-- AddForeignKey
ALTER TABLE "public"."sub_loans" ADD CONSTRAINT "sub_loans_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
