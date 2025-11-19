import { PrismaClient, CollectorWalletTransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Busca gastos de ruta que no tienen transacciones asociadas en collector wallet
 * y crea las transacciones faltantes
 */
async function fixMissingRouteExpenses() {
  console.log('Buscando gastos de ruta sin transacciones en collector wallet...\n');

  // Obtener todos los gastos de ruta
  const routeExpenses = await prisma.routeExpense.findMany({
    include: {
      route: {
        include: {
          manager: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total de gastos de ruta encontrados: ${routeExpenses.length}\n`);

  let created = 0;
  let skipped = 0;

  for (const expense of routeExpenses) {
    // Buscar si ya existe una transacción para este gasto
    const existingTransaction = await prisma.collectorWalletTransaction.findFirst({
      where: {
        description: {
          contains: expense.description,
        },
        type: CollectorWalletTransactionType.ROUTE_EXPENSE,
        createdAt: {
          gte: new Date(expense.createdAt.getTime() - 60000), // 1 minuto antes
          lte: new Date(expense.createdAt.getTime() + 60000), // 1 minuto después
        },
      },
    });

    if (existingTransaction) {
      console.log(`✓ Gasto ${expense.id} ya tiene transacción: ${existingTransaction.id}`);
      skipped++;
      continue;
    }

    console.log(`\nProcesando gasto ${expense.id}:`);
    console.log(`  Ruta: ${expense.routeId}`);
    console.log(`  Manager: ${expense.route.managerId} (${expense.route.manager?.email || 'N/A'})`);
    console.log(`  Monto: ${expense.amount}`);
    console.log(`  Descripción: ${expense.description}`);
    console.log(`  Fecha: ${expense.createdAt}`);

    // Obtener o crear la collector wallet del manager
    let wallet = await prisma.collectorWallet.findUnique({
      where: { userId: expense.route.managerId },
    });

    if (!wallet) {
      console.log(`  Creando collector wallet para manager ${expense.route.managerId}...`);
      wallet = await prisma.collectorWallet.create({
        data: {
          userId: expense.route.managerId,
          balance: new Prisma.Decimal(0),
          currency: 'ARS',
        },
      });
    }

    // Calcular el balance antes del gasto
    // Necesitamos obtener todas las transacciones anteriores a este gasto
    const previousTransactions = await prisma.collectorWalletTransaction.findMany({
      where: {
        walletId: wallet.id,
        createdAt: {
          lt: expense.createdAt,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calcular balance inicial
    let balanceBefore = 0;
    for (const trans of previousTransactions) {
      const amount = Number(trans.amount);
      if (
        trans.type === CollectorWalletTransactionType.COLLECTION ||
        trans.type === CollectorWalletTransactionType.CASH_ADJUSTMENT
      ) {
        balanceBefore += amount;
      } else if (
        trans.type === CollectorWalletTransactionType.WITHDRAWAL ||
        trans.type === CollectorWalletTransactionType.ROUTE_EXPENSE ||
        trans.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT
      ) {
        balanceBefore -= amount;
      }
    }

    const expenseAmount = Number(expense.amount);
    const balanceAfter = balanceBefore - expenseAmount;

    // Crear la transacción faltante
    const transaction = await prisma.collectorWalletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: expense.route.managerId,
        type: CollectorWalletTransactionType.ROUTE_EXPENSE,
        amount: new Prisma.Decimal(expenseAmount),
        currency: wallet.currency,
        description: `Gasto de ruta: ${expense.description}`,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
        createdAt: expense.createdAt, // Usar la fecha original del gasto
      },
    });

    console.log(`  ✓ Transacción creada: ${transaction.id}`);
    console.log(`    Balance: ${balanceBefore} -> ${balanceAfter}`);

    // Actualizar el balance de la wallet
    // Recalcular el balance total basándose en todas las transacciones
    const allTransactions = await prisma.collectorWalletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'asc' },
    });

    let totalBalance = 0;
    for (const trans of allTransactions) {
      const amount = Number(trans.amount);
      if (
        trans.type === CollectorWalletTransactionType.COLLECTION ||
        trans.type === CollectorWalletTransactionType.CASH_ADJUSTMENT
      ) {
        totalBalance += amount;
      } else if (
        trans.type === CollectorWalletTransactionType.WITHDRAWAL ||
        trans.type === CollectorWalletTransactionType.ROUTE_EXPENSE ||
        trans.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT
      ) {
        totalBalance -= amount;
      }
    }

    await prisma.collectorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: new Prisma.Decimal(totalBalance),
      },
    });

    console.log(`  ✓ Balance de wallet actualizado a: ${totalBalance}`);
    created++;
  }

  console.log(`\n✅ Proceso completado:`);
  console.log(`   - Transacciones creadas: ${created}`);
  console.log(`   - Transacciones ya existentes: ${skipped}`);
}

// Ejecutar el script
fixMissingRouteExpenses()
  .catch((error) => {
    console.error('Error al procesar gastos de ruta:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

