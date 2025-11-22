-- Paso 1: Agregar columna subadminId (temporalmente nullable)
ALTER TABLE "safe_expenses" ADD COLUMN "subadminId" TEXT;

-- Paso 2: Migrar datos existentes: obtener el subadminId desde el manager a través de la safe
-- Para cada gasto, obtener el userId de la safe y luego el createdById del manager
UPDATE "safe_expenses" se
SET "subadminId" = (
  SELECT u."createdById"
  FROM "safes" s
  INNER JOIN "users" u ON s."userId" = u."id"
  WHERE s."id" = se."safeId"
  AND u."role" = 'MANAGER'
)
WHERE se."subadminId" IS NULL;

-- Para SUBADMINs que tienen gastos directamente (si existen)
UPDATE "safe_expenses" se
SET "subadminId" = (
  SELECT s."userId"
  FROM "safes" s
  INNER JOIN "users" u ON s."userId" = u."id"
  WHERE s."id" = se."safeId"
  AND u."role" = 'SUBADMIN'
)
WHERE se."subadminId" IS NULL;

-- Paso 3: Eliminar constraint único antiguo
DROP INDEX IF EXISTS "safe_expenses_safeId_name_key";

-- Paso 4: Eliminar foreign key antigua
ALTER TABLE "safe_expenses" DROP CONSTRAINT IF EXISTS "safe_expenses_safeId_fkey";

-- Paso 5: Eliminar columna safeId
ALTER TABLE "safe_expenses" DROP COLUMN "safeId";

-- Paso 6: Hacer subadminId NOT NULL
ALTER TABLE "safe_expenses" ALTER COLUMN "subadminId" SET NOT NULL;

-- Paso 7: Agregar foreign key a users (SUBADMIN)
ALTER TABLE "safe_expenses" ADD CONSTRAINT "safe_expenses_subadminId_fkey" 
  FOREIGN KEY ("subadminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Paso 8: Crear nuevo constraint único por SUBADMIN
CREATE UNIQUE INDEX "safe_expenses_subadminId_name_key" ON "safe_expenses"("subadminId", "name");

-- Paso 9: Actualizar índices
DROP INDEX IF EXISTS "safe_expenses_safeId_idx";
CREATE INDEX IF NOT EXISTS "safe_expenses_subadminId_idx" ON "safe_expenses"("subadminId");


