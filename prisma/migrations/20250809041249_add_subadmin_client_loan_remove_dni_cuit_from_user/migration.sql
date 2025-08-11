/*
  Warnings:

  - You are about to drop the column `cuit` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `dni` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'COMPLETED', 'DEFAULTED');

-- AlterEnum
ALTER TYPE "public"."UserRole" ADD VALUE 'SUBADMIN';

-- DropIndex
DROP INDEX "public"."users_cuit_key";

-- DropIndex
DROP INDEX "public"."users_dni_key";

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "cuit",
DROP COLUMN "dni";

-- CreateTable
CREATE TABLE "public"."clients" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dni" TEXT,
    "cuit" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_managers" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loans" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "public"."LoanStatus" NOT NULL DEFAULT 'PENDING',
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "interestRate" DECIMAL(5,2),
    "term" INTEGER,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_dni_key" ON "public"."clients"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "clients_cuit_key" ON "public"."clients"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "client_managers_clientId_userId_key" ON "public"."client_managers"("clientId", "userId");

-- AddForeignKey
ALTER TABLE "public"."client_managers" ADD CONSTRAINT "client_managers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_managers" ADD CONSTRAINT "client_managers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
