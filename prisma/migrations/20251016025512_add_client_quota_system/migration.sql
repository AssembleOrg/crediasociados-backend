-- AlterEnum
ALTER TYPE "public"."ConfigKey" ADD VALUE 'ADMIN_MAX_CLIENTS';

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "clientQuota" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "usedClientQuota" INTEGER NOT NULL DEFAULT 0;
