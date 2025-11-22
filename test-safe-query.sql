-- Verificar si hay transacciones en safe_transactions
SELECT COUNT(*) as total_transactions FROM safe_transactions;

-- Verificar si hay safes
SELECT id, "userId", balance FROM safes;

-- Verificar transacciones con detalles
SELECT 
  st.id,
  st.type,
  st.amount,
  st."safeId",
  s."userId",
  st."createdAt"
FROM safe_transactions st
LEFT JOIN safes s ON st."safeId" = s.id
ORDER BY st."createdAt" DESC
LIMIT 10;
