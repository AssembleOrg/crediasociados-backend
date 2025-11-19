import { PrismaClient, CollectorWalletTransactionType, WalletTransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Busca retiros de collector wallet que no tienen transacciones asociadas en la wallet del SUBADMIN
 * y crea las transacciones faltantes
 */
async function fixMissingSubadminWithdrawalTransactions() {
  console.log('Buscando retiros de collector wallet sin transacciones en wallet del SUBADMIN...\n');

  // Buscar todos los retiros de collector wallet que fueron hechos por SUBADMIN
  const withdrawals = await prisma.collectorWalletTransaction.findMany({
    where: {
      type: CollectorWalletTransactionType.WITHDRAWAL,
      description: {
        contains: 'SUBADMIN',
      },
    },
    include: {
      wallet: {
        include: {
          user: {
            include: {
              createdBy: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total de retiros por SUBADMIN encontrados: ${withdrawals.length}\n`);

  let created = 0;
  let skipped = 0;

  for (const withdrawal of withdrawals) {
    const manager = withdrawal.wallet.user;
    
    if (!manager.createdBy) {
      console.log(`⚠️  Manager ${manager.id} no tiene creador asignado. Saltando...`);
      skipped++;
      continue;
    }

    const subadminId = manager.createdBy.id;
    const withdrawalAmount = Number(withdrawal.amount);

    console.log(`\nProcesando retiro ${withdrawal.id}:`);
    console.log(`  Manager: ${manager.email} (${manager.id})`);
    console.log(`  SUBADMIN: ${manager.createdBy.email} (${subadminId})`);
    console.log(`  Monto: ${withdrawalAmount}`);
    console.log(`  Fecha: ${withdrawal.createdAt}`);

    // Buscar si ya existe una transacción en la wallet del SUBADMIN para este retiro
    const existingTransaction = await prisma.walletTransaction.findFirst({
      where: {
        userId: subadminId,
        type: WalletTransactionType.TRANSFER_FROM_SUBADMIN,
        relatedUserId: manager.id,
        amount: withdrawalAmount,
        createdAt: {
          gte: new Date(withdrawal.createdAt.getTime() - 60000), // 1 minuto antes
          lte: new Date(withdrawal.createdAt.getTime() + 60000), // 1 minuto después
        },
      },
    });

    if (existingTransaction) {
      console.log(`  ✓ Ya existe transacción: ${existingTransaction.id}`);
      skipped++;
      continue;
    }

    // Obtener wallet del SUBADMIN
    let subadminWallet = await prisma.wallet.findUnique({
      where: { userId: subadminId },
    });

    if (!subadminWallet) {
      console.log(`  ⚠️  Wallet del SUBADMIN no encontrada. Creando...`);
      subadminWallet = await prisma.wallet.create({
        data: {
          userId: subadminId,
          balance: new Prisma.Decimal(0),
          currency: 'ARS',
        },
      });
    }

    // Calcular el balance antes del retiro
    // Necesitamos obtener todas las transacciones anteriores a este retiro
    const previousTransactions = await prisma.walletTransaction.findMany({
      where: {
        walletId: subadminWallet.id,
        createdAt: {
          lt: withdrawal.createdAt,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calcular balance inicial
    let balanceBefore = Number(subadminWallet.balance);
    
    // Retroceder desde el balance actual restando todas las transacciones posteriores
    const laterTransactions = await prisma.walletTransaction.findMany({
      where: {
        walletId: subadminWallet.id,
        createdAt: {
          gte: withdrawal.createdAt,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calcular balance antes del retiro restando las transacciones posteriores
    for (const trans of laterTransactions) {
      const amount = Number(trans.amount);
      if (
        trans.type === WalletTransactionType.DEPOSIT ||
        trans.type === WalletTransactionType.LOAN_PAYMENT ||
        trans.type === WalletTransactionType.TRANSFER_FROM_SUBADMIN
      ) {
        // Estas transacciones incrementan el balance, así que las restamos para retroceder
        balanceBefore -= amount;
      } else if (
        trans.type === WalletTransactionType.WITHDRAWAL ||
        trans.type === WalletTransactionType.LOAN_DISBURSEMENT ||
        trans.type === WalletTransactionType.TRANSFER_TO_MANAGER
      ) {
        // Estas transacciones decrementan el balance, así que las sumamos para retroceder
        balanceBefore += amount;
      }
    }

    const balanceAfter = balanceBefore + withdrawalAmount; // Se suma porque es un ingreso para el SUBADMIN

    // Crear la transacción faltante
    const transaction = await prisma.walletTransaction.create({
      data: {
        walletId: subadminWallet.id,
        userId: subadminId,
        type: WalletTransactionType.TRANSFER_FROM_SUBADMIN,
        amount: new Prisma.Decimal(withdrawalAmount),
        currency: subadminWallet.currency,
        description: `Retiro de collector wallet del manager: ${withdrawal.description.replace('Retiro por SUBADMIN: ', '')}`,
        relatedUserId: manager.id,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
        createdAt: withdrawal.createdAt, // Usar la fecha original del retiro
      },
    });

    console.log(`  ✓ Transacción creada: ${transaction.id}`);
    console.log(`    Balance: ${balanceBefore} -> ${balanceAfter}`);

    // Recalcular el balance total de la wallet del SUBADMIN
    const allTransactions = await prisma.walletTransaction.findMany({
      where: { walletId: subadminWallet.id },
      orderBy: { createdAt: 'asc' },
    });

    let totalBalance = 0;
    for (const trans of allTransactions) {
      const amount = Number(trans.amount);
      if (
        trans.type === WalletTransactionType.DEPOSIT ||
        trans.type === WalletTransactionType.LOAN_PAYMENT ||
        trans.type === WalletTransactionType.TRANSFER_FROM_SUBADMIN
      ) {
        totalBalance += amount;
      } else if (
        trans.type === WalletTransactionType.WITHDRAWAL ||
        trans.type === WalletTransactionType.LOAN_DISBURSEMENT ||
        trans.type === WalletTransactionType.TRANSFER_TO_MANAGER
      ) {
        totalBalance -= amount;
      }
    }

    await prisma.wallet.update({
      where: { id: subadminWallet.id },
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
fixMissingSubadminWithdrawalTransactions()
  .catch((error) => {
    console.error('Error al procesar retiros:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

