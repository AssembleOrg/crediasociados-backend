-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('CLIENT_CREATED', 'CLIENT_LOSS', 'CLIENT_LOSS_REVERTED', 'LOAN_FINISHED_EARLY');

-- CreateTable
CREATE TABLE "public"."client_losses" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'PERDIDA',
    "notes" TEXT,
    "lostAmount" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "loansSnapshot" JSONB NOT NULL,
    "lossAt" TIMESTAMP(3) NOT NULL,
    "blacklistId" TEXT,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_losses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_losses_managerId_idx" ON "public"."client_losses"("managerId");

-- CreateIndex
CREATE INDEX "client_losses_clientId_idx" ON "public"."client_losses"("clientId");

-- CreateIndex
CREATE INDEX "client_losses_createdAt_idx" ON "public"."client_losses"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "public"."notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "public"."notifications"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."client_losses" ADD CONSTRAINT "client_losses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_losses" ADD CONSTRAINT "client_losses_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_losses" ADD CONSTRAINT "client_losses_revertedById_fkey" FOREIGN KEY ("revertedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

