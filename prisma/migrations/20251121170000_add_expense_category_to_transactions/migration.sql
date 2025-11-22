-- Agregar columna expenseId a safe_transactions para referenciar la categoría de gasto
ALTER TABLE "safe_transactions" ADD COLUMN "expenseId" TEXT;

-- Agregar foreign key a safe_expenses
ALTER TABLE "safe_transactions" ADD CONSTRAINT "safe_transactions_expenseId_fkey" 
  FOREIGN KEY ("expenseId") REFERENCES "safe_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Crear índice para mejorar las consultas
CREATE INDEX IF NOT EXISTS "safe_transactions_expenseId_idx" ON "safe_transactions"("expenseId");

