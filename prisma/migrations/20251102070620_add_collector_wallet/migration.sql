-- CreateEnum
CREATE TYPE "public"."CollectorWalletTransactionType" AS ENUM ('COLLECTION', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "public"."collector_wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collector_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collector_wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."CollectorWalletTransactionType" NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "description" TEXT NOT NULL,
    "balanceBefore" DECIMAL(40,2) NOT NULL,
    "balanceAfter" DECIMAL(40,2) NOT NULL,
    "subLoanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collector_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collector_wallets_userId_key" ON "public"."collector_wallets"("userId");

-- CreateIndex
CREATE INDEX "collector_wallet_transactions_walletId_idx" ON "public"."collector_wallet_transactions"("walletId");

-- CreateIndex
CREATE INDEX "collector_wallet_transactions_userId_idx" ON "public"."collector_wallet_transactions"("userId");

-- CreateIndex
CREATE INDEX "collector_wallet_transactions_type_idx" ON "public"."collector_wallet_transactions"("type");

-- CreateIndex
CREATE INDEX "collector_wallet_transactions_createdAt_idx" ON "public"."collector_wallet_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "collector_wallet_transactions_subLoanId_idx" ON "public"."collector_wallet_transactions"("subLoanId");

-- AddForeignKey
ALTER TABLE "public"."collector_wallets" ADD CONSTRAINT "collector_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collector_wallet_transactions" ADD CONSTRAINT "collector_wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."collector_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collector_wallet_transactions" ADD CONSTRAINT "collector_wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
