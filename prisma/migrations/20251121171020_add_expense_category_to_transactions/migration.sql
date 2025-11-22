-- Agregar columna expenseId a safe_transactions para referenciar la categoría de gasto (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'safe_transactions' AND column_name = 'expenseId'
  ) THEN
    ALTER TABLE "safe_transactions" ADD COLUMN "expenseId" TEXT;
  END IF;
END $$;

-- Agregar foreign key a safe_expenses (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'safe_transactions_expenseId_fkey'
  ) THEN
    ALTER TABLE "safe_transactions" ADD CONSTRAINT "safe_transactions_expenseId_fkey" 
      FOREIGN KEY ("expenseId") REFERENCES "safe_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Crear índice para mejorar las consultas (si no existe)
CREATE INDEX IF NOT EXISTS "safe_transactions_expenseId_idx" ON "safe_transactions"("expenseId");
