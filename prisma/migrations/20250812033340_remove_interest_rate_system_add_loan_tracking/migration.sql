/*
  Warnings:

  - You are about to drop the column `interestRate` on the `sub_loans` table. All the data in the column will be lost.
  - You are about to drop the `interest_rate_configs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."interest_rate_configs" DROP CONSTRAINT "interest_rate_configs_subAdminId_fkey";

-- AlterTable
ALTER TABLE "public"."sub_loans" DROP COLUMN "interestRate";

-- DropTable
DROP TABLE "public"."interest_rate_configs";
