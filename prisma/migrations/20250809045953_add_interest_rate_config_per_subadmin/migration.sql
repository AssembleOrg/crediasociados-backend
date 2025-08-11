-- CreateTable
CREATE TABLE "public"."interest_rate_configs" (
    "id" TEXT NOT NULL,
    "subAdminId" TEXT NOT NULL,
    "daysOverdue" INTEGER NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "interest_rate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interest_rate_configs_subAdminId_daysOverdue_key" ON "public"."interest_rate_configs"("subAdminId", "daysOverdue");

-- AddForeignKey
ALTER TABLE "public"."interest_rate_configs" ADD CONSTRAINT "interest_rate_configs_subAdminId_fkey" FOREIGN KEY ("subAdminId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
