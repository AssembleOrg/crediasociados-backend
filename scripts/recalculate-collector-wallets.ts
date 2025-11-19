import { PrismaClient } from '@prisma/client';
import { CollectorWalletTransactionType } from '../src/common/enums';

const prisma = new PrismaClient();

async function recalculateAllCollectorWallets() {
  console.log('\n🔄 Iniciando recalculación de balances de wallets de cobros...\n');

  try {
    // Obtener todas las wallets de cobros
    const wallets = await prisma.collectorWallet.findMany({
      select: {
        id: true,
        userId: true,
        balance: true,
      },
    });

    console.log(`📊 Encontradas ${wallets.length} wallets de cobros\n`);

    let updatedCount = 0;
    let totalDiscrepancy = 0;

    for (const wallet of wallets) {
      // Obtener todas las transacciones de esta wallet
      const transactions = await prisma.collectorWalletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'asc' },
      });

      // Calcular balance desde transacciones
      let calculatedBalance = 0;
      for (const transaction of transactions) {
        if (transaction.type === CollectorWalletTransactionType.COLLECTION) {
          calculatedBalance += Number(transaction.amount);
        } else if (transaction.type === CollectorWalletTransactionType.WITHDRAWAL) {
          calculatedBalance -= Number(transaction.amount);
        }
      }

      const storedBalance = Number(wallet.balance);
      const discrepancy = Math.abs(calculatedBalance - storedBalance);

      if (discrepancy > 0.01) {
        console.log(`⚠️  Wallet ${wallet.id} (Usuario: ${wallet.userId}):`);
        console.log(`   Balance almacenado: $${storedBalance.toFixed(2)}`);
        console.log(`   Balance calculado: $${calculatedBalance.toFixed(2)}`);
        console.log(`   Diferencia: $${discrepancy.toFixed(2)}`);
        console.log(`   Transacciones: ${transactions.length}`);

        // Actualizar balance
        await prisma.collectorWallet.update({
          where: { id: wallet.id },
          data: {
            balance: calculatedBalance,
          },
        });

        console.log(`   ✅ Balance actualizado a $${calculatedBalance.toFixed(2)}\n`);
        updatedCount++;
        totalDiscrepancy += discrepancy;
      } else {
        console.log(`✅ Wallet ${wallet.id}: Balance correcto ($${storedBalance.toFixed(2)})\n`);
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   - Wallets procesadas: ${wallets.length}`);
    console.log(`   - Wallets actualizadas: ${updatedCount}`);
    console.log(`   - Diferencia total corregida: $${totalDiscrepancy.toFixed(2)}`);

    if (updatedCount > 0) {
      console.log('\n✅ Recalculación completada. Balances corregidos.');
    } else {
      console.log('\n✅ Todos los balances están correctos.');
    }

    console.log('\n✨ Script ejecutado exitosamente\n');
  } catch (error) {
    console.error('❌ Error durante la ejecución:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar el script
recalculateAllCollectorWallets()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });


