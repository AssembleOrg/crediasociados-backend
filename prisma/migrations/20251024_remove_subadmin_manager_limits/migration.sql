-- Remove old config entries before altering enum
DELETE FROM "public"."system_config" WHERE "key" IN ('ADMIN_MAX_SUBADMINS', 'SUBADMIN_MAX_MANAGERS');

-- AlterEnum to remove unused values
ALTER TYPE "public"."ConfigKey" RENAME TO "ConfigKey_old";
CREATE TYPE "public"."ConfigKey" AS ENUM ('ADMIN_MAX_CLIENTS');
ALTER TABLE "public"."system_config" ALTER COLUMN "key" TYPE "public"."ConfigKey" USING ("key"::text::"public"."ConfigKey");
DROP TYPE "public"."ConfigKey_old";

