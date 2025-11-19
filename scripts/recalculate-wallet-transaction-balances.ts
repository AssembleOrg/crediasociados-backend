import { PrismaClient, WalletTransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Recalcula los balances (balanceBefore y balanceAfter) para todas las transacciones de wallet
 * basándose en el orden cronológico y el tipo de transacción
 */
async function recalculateWalletTransactionBalances() {
  console.log('Iniciando recálculo de balances de transacciones de wallet...');

  // Obtener todas las wallets
  const wallets = await prisma.wallet.findMany({
    include: {
      transactions: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  let totalUpdated = 0;

  for (const wallet of wallets) {
    console.log(`\nProcesando wallet ${wallet.id} (userId: ${wallet.userId})`);
    
    // Calcular balance inicial (puede ser 0 o el balance actual menos todas las transacciones)
    let currentBalance = 0;
    
    // Si hay transacciones, calcular el balance inicial retrocediendo desde el balance actual
    if (wallet.transactions.length > 0) {
      // Calcular balance inicial: balance actual - suma de todas las transacciones
      let calculatedInitialBalance = Number(wallet.balance);
      
      for (const transaction of wallet.transactions) {
        const amount = Number(transaction.amount);
        if (
          transaction.type === WalletTransactionType.DEPOSIT ||
          transaction.type === WalletTransactionType.LOAN_PAYMENT ||
          transaction.type === WalletTransactionType.TRANSFER_FROM_SUBADMIN
        ) {
          // Estas transacciones incrementan el balance
          calculatedInitialBalance -= amount;
        } else if (
          transaction.type === WalletTransactionType.WITHDRAWAL ||
          transaction.type === WalletTransactionType.LOAN_DISBURSEMENT ||
          transaction.type === WalletTransactionType.TRANSFER_TO_MANAGER
        ) {
          // Estas transacciones decrementan el balance
          calculatedInitialBalance += amount;
        }
      }
      
      currentBalance = calculatedInitialBalance;
    }

    console.log(`  Balance inicial calculado: ${currentBalance}`);
    console.log(`  Total de transacciones: ${wallet.transactions.length}`);

    // Procesar cada transacción en orden cronológico
    for (let i = 0; i < wallet.transactions.length; i++) {
      const transaction = wallet.transactions[i];
      const balanceBefore = currentBalance;
      
      // Calcular balance después según el tipo de transacción
      const amount = Number(transaction.amount);
      let balanceAfter = balanceBefore;

      if (
        transaction.type === WalletTransactionType.DEPOSIT ||
        transaction.type === WalletTransactionType.LOAN_PAYMENT ||
        transaction.type === WalletTransactionType.TRANSFER_FROM_SUBADMIN
      ) {
        // Estas transacciones incrementan el balance
        balanceAfter = balanceBefore + amount;
      } else if (
        transaction.type === WalletTransactionType.WITHDRAWAL ||
        transaction.type === WalletTransactionType.LOAN_DISBURSEMENT ||
        transaction.type === WalletTransactionType.TRANSFER_TO_MANAGER
      ) {
        // Estas transacciones decrementan el balance
        balanceAfter = balanceBefore - amount;
      }

      // Actualizar la transacción con los balances calculados
      await prisma.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      console.log(
        `  Transacción ${i + 1}/${wallet.transactions.length} (${transaction.type}): ` +
        `Balance ${balanceBefore} -> ${balanceAfter} (monto: ${amount})`,
      );

      // Actualizar balance actual para la siguiente transacción
      currentBalance = balanceAfter;
      totalUpdated++;
    }

    // Verificar que el balance final coincide con el balance actual de la wallet
    const finalBalance = currentBalance;
    const walletBalance = Number(wallet.balance);
    
    if (Math.abs(finalBalance - walletBalance) > 0.01) {
      console.warn(
        `  ⚠️  ADVERTENCIA: El balance calculado (${finalBalance}) no coincide con el balance de la wallet (${walletBalance})`,
      );
    } else {
      console.log(`  ✓ Balance final verificado: ${finalBalance}`);
    }
  }

  console.log(`\n✅ Recalculo completado. Total de transacciones actualizadas: ${totalUpdated}`);
}

// Ejecutar el script
recalculateWalletTransactionBalances()
  .catch((error) => {
    console.error('Error al recalcular balances:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

