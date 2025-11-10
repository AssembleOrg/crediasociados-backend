#!/bin/bash

# Script para actualizar el servicio con los cambios de expenses

FILE="/media/charly/extras/Pistech/crediasociados-backend/src/collection-routes/collection-routes.service.ts"

# Backup ya existe

# Agregar expenses a los includes (reemplazar transactions por expenses en los includes)
sed -i 's/transactions: {/expenses: {/g' "$FILE"

echo "Servicio actualizado con includes de expenses"


