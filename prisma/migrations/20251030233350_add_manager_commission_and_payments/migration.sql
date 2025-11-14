-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN "commission" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "public"."manager_payments" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'ARS',
    "description" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manager_payments_managerId_idx" ON "public"."manager_payments"("managerId");

-- CreateIndex
CREATE INDEX "manager_payments_paymentDate_idx" ON "public"."manager_payments"("paymentDate");

-- AddForeignKey
ALTER TABLE "public"."manager_payments" ADD CONSTRAINT "manager_payments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;






