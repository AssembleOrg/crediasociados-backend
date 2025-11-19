-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN "balanceBefore" DECIMAL(40,2);
ALTER TABLE "wallet_transactions" ADD COLUMN "balanceAfter" DECIMAL(40,2);
