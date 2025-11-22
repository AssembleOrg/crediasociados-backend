-- Eliminar la columna amount de safe_expenses
-- El monto solo se guardará en las transacciones históricas (safe_transactions)
ALTER TABLE "safe_expenses" DROP COLUMN IF EXISTS "amount";

