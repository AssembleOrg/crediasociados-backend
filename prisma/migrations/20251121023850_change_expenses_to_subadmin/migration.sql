-- Verificar si la columna subadminId ya existe, si no, crearla
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'safe_expenses' AND column_name = 'subadminId'
  ) THEN
    ALTER TABLE "safe_expenses" ADD COLUMN "subadminId" TEXT;
  END IF;
END $$;

-- Migrar datos existentes: obtener el subadminId desde el manager a través de la safe
UPDATE "safe_expenses" se
SET "subadminId" = (
  SELECT u."createdById"
  FROM "safes" s
  INNER JOIN "users" u ON s."userId" = u."id"
  WHERE s."id" = se."safeId"
  AND u."role" = 'MANAGER'
)
WHERE se."subadminId" IS NULL AND se."safeId" IS NOT NULL;

-- Para SUBADMINs que tienen gastos directamente (si existen)
UPDATE "safe_expenses" se
SET "subadminId" = (
  SELECT s."userId"
  FROM "safes" s
  INNER JOIN "users" u ON s."userId" = u."id"
  WHERE s."id" = se."safeId"
  AND u."role" = 'SUBADMIN'
)
WHERE se."subadminId" IS NULL AND se."safeId" IS NOT NULL;

-- Eliminar constraint único antiguo si existe
DROP INDEX IF EXISTS "safe_expenses_safeId_name_key";

-- Eliminar foreign key antigua si existe
ALTER TABLE "safe_expenses" DROP CONSTRAINT IF EXISTS "safe_expenses_safeId_fkey";

-- Eliminar columna safeId si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'safe_expenses' AND column_name = 'safeId'
  ) THEN
    ALTER TABLE "safe_expenses" DROP COLUMN "safeId";
  END IF;
END $$;

-- Hacer subadminId NOT NULL si no lo es
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'safe_expenses' 
    AND column_name = 'subadminId' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "safe_expenses" ALTER COLUMN "subadminId" SET NOT NULL;
  END IF;
END $$;

-- Agregar foreign key a users (SUBADMIN) si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'safe_expenses_subadminId_fkey'
  ) THEN
    ALTER TABLE "safe_expenses" ADD CONSTRAINT "safe_expenses_subadminId_fkey" 
      FOREIGN KEY ("subadminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Crear nuevo constraint único por SUBADMIN si no existe
CREATE UNIQUE INDEX IF NOT EXISTS "safe_expenses_subadminId_name_key" ON "safe_expenses"("subadminId", "name");

-- Actualizar índices
DROP INDEX IF EXISTS "safe_expenses_safeId_idx";
CREATE INDEX IF NOT EXISTS "safe_expenses_subadminId_idx" ON "safe_expenses"("subadminId");
