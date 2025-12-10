import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Script para recalcular y actualizar los balanceBefore/balanceAfter
 * de todas las transacciones de collector wallet.
 * 
 * Esto corrige inconsistencias causadas por reseteos de pagos.
 */
async function recalculateCollectorWalletBalances() {
  console.log('\n🔄 Recalculando balances de transacciones de collector wallet...\n');

  try {
    // Obtener todas las wallets
    const wallets = await prisma.collectorWallet.findMany({
      select: {
        id: true,
        userId: true,
        balance: true,
      },
    });

    console.log(`📊 Encontradas ${wallets.length} wallets\n`);

    let totalUpdated = 0;
    let totalWalletsFixed = 0;

    for (const wallet of wallets) {
      // Obtener todas las transacciones de esta wallet ordenadas cronológicamente
      const transactions = await prisma.collectorWalletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'asc' },
      });

      if (transactions.length === 0) {
        continue;
      }

      console.log(`\n📋 Wallet ${wallet.id}: ${transactions.length} transacciones`);

      let runningBalance = 0;
      let updatesNeeded = 0;

      for (const t of transactions) {
        const balanceBefore = runningBalance;
        const amount = Number(t.amount);

        // Calcular el efecto en el balance según el tipo
        if (
          t.type === 'COLLECTION' ||
          t.type === 'CASH_ADJUSTMENT' ||
          t.type === 'PAYMENT_RESET'
        ) {
          // COLLECTION y CASH_ADJUSTMENT tienen amount positivo, PAYMENT_RESET tiene amount negativo
          runningBalance += amount;
        } else if (
          t.type === 'WITHDRAWAL' ||
          t.type === 'ROUTE_EXPENSE' ||
          t.type === 'LOAN_DISBURSEMENT'
        ) {
          runningBalance -= amount;
        }

        const balanceAfter = runningBalance;

        // Verificar si necesita actualización
        const storedBalanceBefore = Number(t.balanceBefore);
        const storedBalanceAfter = Number(t.balanceAfter);

        if (
          Math.abs(storedBalanceBefore - balanceBefore) > 0.01 ||
          Math.abs(storedBalanceAfter - balanceAfter) > 0.01
        ) {
          // Actualizar la transacción
          await prisma.collectorWalletTransaction.update({
            where: { id: t.id },
            data: {
              balanceBefore: balanceBefore,
              balanceAfter: balanceAfter,
            },
          });

          console.log(
            `   ✏️  Tx ${t.id.substring(0, 10)}... (${t.type}): ` +
            `${storedBalanceBefore} → ${balanceBefore} | ${storedBalanceAfter} → ${balanceAfter}`
          );

          updatesNeeded++;
          totalUpdated++;
        }
      }

      // Verificar y actualizar el balance de la wallet si es necesario
      const storedWalletBalance = Number(wallet.balance);
      if (Math.abs(storedWalletBalance - runningBalance) > 0.01) {
        await prisma.collectorWallet.update({
          where: { id: wallet.id },
          data: { balance: runningBalance },
        });
        console.log(
          `   💰 Wallet balance actualizado: ${storedWalletBalance} → ${runningBalance}`
        );
        totalWalletsFixed++;
      }

      if (updatesNeeded > 0) {
        console.log(`   ✅ ${updatesNeeded} transacciones actualizadas`);
      } else {
        console.log(`   ✅ Todos los balances correctos`);
      }
    }

    console.log(`\n✅ Recálculo completado:`);
    console.log(`   - ${totalUpdated} transacciones actualizadas`);
    console.log(`   - ${totalWalletsFixed} wallets corregidas\n`);
  } catch (error: any) {
    console.error('❌ Error al recalcular balances:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

recalculateCollectorWalletBalances()
  .then(() => {
    console.log('✅ Script completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
