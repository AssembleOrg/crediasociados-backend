-- CreateEnum
CREATE TYPE "SafeTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'TRANSFER_TO_COLLECTOR', 'TRANSFER_FROM_COLLECTOR', 'TRANSFER_TO_SAFE', 'TRANSFER_FROM_SAFE');

-- CreateTable
CREATE TABLE "safes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_transactions" (
    "id" TEXT NOT NULL,
    "safeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SafeTransactionType" NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "description" TEXT NOT NULL,
    "balanceBefore" DECIMAL(40,2) NOT NULL,
    "balanceAfter" DECIMAL(40,2) NOT NULL,
    "relatedUserId" TEXT,
    "relatedSafeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safe_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_expenses" (
    "id" TEXT NOT NULL,
    "safeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safe_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "safes_userId_key" ON "safes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "safe_expenses_safeId_name_key" ON "safe_expenses"("safeId", "name");

-- CreateIndex
CREATE INDEX "safe_transactions_safeId_idx" ON "safe_transactions"("safeId");

-- CreateIndex
CREATE INDEX "safe_transactions_userId_idx" ON "safe_transactions"("userId");

-- CreateIndex
CREATE INDEX "safe_transactions_type_idx" ON "safe_transactions"("type");

-- CreateIndex
CREATE INDEX "safe_transactions_createdAt_idx" ON "safe_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "safe_expenses_safeId_idx" ON "safe_expenses"("safeId");

-- CreateIndex
CREATE INDEX "safe_expenses_name_idx" ON "safe_expenses"("name");

-- AddForeignKey
ALTER TABLE "safes" ADD CONSTRAINT "safes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_transactions" ADD CONSTRAINT "safe_transactions_safeId_fkey" FOREIGN KEY ("safeId") REFERENCES "safes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_transactions" ADD CONSTRAINT "safe_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_expenses" ADD CONSTRAINT "safe_expenses_safeId_fkey" FOREIGN KEY ("safeId") REFERENCES "safes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

