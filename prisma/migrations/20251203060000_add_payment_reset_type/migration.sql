-- AlterEnum
ALTER TYPE "public"."CollectorWalletTransactionType" ADD VALUE 'PAYMENT_RESET';

-- Actualizar registros existentes que son reseteos
UPDATE "public"."collector_wallet_transactions"
SET "type" = 'PAYMENT_RESET'
WHERE "type" = 'COLLECTION'
  AND "description" ILIKE '%Reseteo%'
  AND "amount" < 0;

