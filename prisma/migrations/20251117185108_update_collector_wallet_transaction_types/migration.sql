-- AlterEnum
ALTER TYPE "public"."CollectorWalletTransactionType" ADD VALUE IF NOT EXISTS 'ROUTE_EXPENSE';
ALTER TYPE "public"."CollectorWalletTransactionType" ADD VALUE IF NOT EXISTS 'LOAN_DISBURSEMENT';
