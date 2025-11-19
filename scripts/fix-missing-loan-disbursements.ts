import { PrismaClient, CollectorWalletTransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Busca préstamos que no tienen transacciones LOAN_DISBURSEMENT asociadas
 * y crea las transacciones faltantes
 */
async function fixMissingLoanDisbursements() {
  console.log('Buscando préstamos sin transacciones LOAN_DISBURSEMENT...\n');

  // Obtener todos los préstamos que no están eliminados
  const loans = await prisma.loan.findMany({
    where: {
      deletedAt: null,
    },
    include: {
      client: {
        include: {
          managers: {
            where: {
              deletedAt: null,
            },
            include: {
              user: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total de préstamos encontrados: ${loans.length}\n`);

  let created = 0;
  let skipped = 0;

  for (const loan of loans) {
    // Obtener el manager del préstamo (el primer manager activo del cliente)
    const manager = loan.client.managers[0];
    
    if (!manager) {
      console.log(`⚠️  Préstamo ${loan.loanTrack} no tiene manager asignado. Saltando...`);
      skipped++;
      continue;
    }

    const managerId = manager.userId;
    const loanAmount = Number(loan.amount);

    console.log(`\nProcesando préstamo ${loan.loanTrack}:`);
    console.log(`  Manager: ${manager.user.email} (${managerId})`);
    console.log(`  Monto: ${loanAmount}`);
    console.log(`  Fecha: ${loan.createdAt}`);

    // Buscar si ya existe una transacción para este préstamo
    const existingTransaction = await prisma.collectorWalletTransaction.findFirst({
      where: {
        wallet: {
          userId: managerId,
        },
        type: CollectorWalletTransactionType.LOAN_DISBURSEMENT,
        amount: loanAmount,
        description: {
          contains: loan.loanTrack,
        },
        createdAt: {
          gte: new Date(loan.createdAt.getTime() - 60000), // 1 minuto antes
          lte: new Date(loan.createdAt.getTime() + 60000), // 1 minuto después
        },
      },
    });

    if (existingTransaction) {
      console.log(`  ✓ Ya existe transacción: ${existingTransaction.id}`);
      skipped++;
      continue;
    }

    // Obtener o crear la collector wallet del manager
    let wallet = await prisma.collectorWallet.findUnique({
      where: { userId: managerId },
    });

    if (!wallet) {
      console.log(`  Creando collector wallet para manager ${managerId}...`);
      wallet = await prisma.collectorWallet.create({
        data: {
          userId: managerId,
          balance: new Prisma.Decimal(0),
          currency: 'ARS',
        },
      });
    }

    // Calcular el balance antes del préstamo
    // Necesitamos obtener todas las transacciones anteriores a este préstamo
    const previousTransactions = await prisma.collectorWalletTransaction.findMany({
      where: {
        walletId: wallet.id,
        createdAt: {
          lt: loan.createdAt,
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

    const balanceAfter = balanceBefore - loanAmount; // Se resta porque es un desembolso

    // Crear la transacción faltante
    const transaction = await prisma.collectorWalletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: managerId,
        type: CollectorWalletTransactionType.LOAN_DISBURSEMENT,
        amount: new Prisma.Decimal(loanAmount),
        currency: wallet.currency,
        description: `Préstamo ${loan.loanTrack} - Desembolso`,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
        createdAt: loan.createdAt, // Usar la fecha original del préstamo
      },
    });

    console.log(`  ✓ Transacción creada: ${transaction.id}`);
    console.log(`    Balance: ${balanceBefore} -> ${balanceAfter}`);

    // Recalcular el balance total de la wallet
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
fixMissingLoanDisbursements()
  .catch((error) => {
    console.error('Error al procesar préstamos:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

