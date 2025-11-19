import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupSubadminData(subadminEmail: string) {
  console.log(`\n🧹 Iniciando limpieza de datos para SUBADMIN: ${subadminEmail}\n`);

  try {
    // 1. Encontrar el SUBADMIN
    const subadmin = await prisma.user.findUnique({
      where: { email: subadminEmail },
      select: { id: true, email: true, fullName: true, role: true, usedClientQuota: true },
    });

    if (!subadmin) {
      throw new Error(`SUBADMIN con email ${subadminEmail} no encontrado`);
    }

    if (subadmin.role !== 'SUBADMIN') {
      throw new Error(`El usuario ${subadminEmail} no es un SUBADMIN`);
    }

    console.log(`✅ SUBADMIN encontrado: ${subadmin.fullName} (${subadmin.id})`);
    console.log(`   usedClientQuota actual: ${subadmin.usedClientQuota}\n`);

    // 2. Obtener wallet del SUBADMIN para resetear saldo y eliminar transferencias
    const subadminWallet = await prisma.wallet.findUnique({
      where: { userId: subadmin.id },
      select: { id: true, balance: true },
    });

    if (subadminWallet) {
      console.log(`💰 Wallet del SUBADMIN encontrada. Saldo actual: ${subadminWallet.balance}\n`);
    }

    // 3. Encontrar todos los managers creados por este SUBADMIN (incluyendo los que tienen soft delete)
    const managers = await prisma.user.findMany({
      where: {
        createdById: subadmin.id,
        role: 'MANAGER',
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        deletedAt: true,
        clientQuota: true,
      },
    });

    console.log(`📋 Encontrados ${managers.length} managers\n`);

    if (managers.length === 0) {
      console.log('⚠️  No hay managers para limpiar.');
      console.log('🔄 Recalculando usedClientQuota del SUBADMIN...\n');
      
      // Recalcular usedClientQuota basándose en los managers que aún existen
      const remainingManagers = await prisma.user.findMany({
        where: {
          createdById: subadmin.id,
          role: 'MANAGER',
          deletedAt: null,
        },
        select: {
          clientQuota: true,
        },
      });

      const recalculatedQuota = remainingManagers.reduce((sum, manager) => sum + manager.clientQuota, 0);
      
      const finalSubadmin = await prisma.user.update({
        where: { id: subadmin.id },
        data: {
          usedClientQuota: recalculatedQuota,
        },
        select: {
          usedClientQuota: true,
        },
      });
      
      console.log(`  ✅ usedClientQuota recalculado: ${subadmin.usedClientQuota} -> ${finalSubadmin.usedClientQuota}`);
      console.log(`  ✅ Basado en ${remainingManagers.length} managers existentes\n`);
      
      // Limpiar transferencias del SUBADMIN y resetear su wallet si es necesario
      if (subadminWallet && Number(subadminWallet.balance) !== 0) {
        console.log('🔄 Limpiando transferencias del SUBADMIN y reseteando wallet...\n');
        
        await prisma.$transaction(async (tx) => {
          // Eliminar transferencias del SUBADMIN (TRANSFER_TO_MANAGER y TRANSFER_FROM_SUBADMIN)
          const deletedSubadminTransfers = await tx.walletTransaction.deleteMany({
            where: {
              walletId: subadminWallet.id,
              type: {
                in: ['TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN'],
              },
            },
          });
          console.log(`  ✅ Eliminadas ${deletedSubadminTransfers.count} transferencias del SUBADMIN`);

          // Eliminar transferencias relacionadas con el SUBADMIN (donde relatedUserId es el subadmin)
          const deletedRelatedTransfers = await tx.walletTransaction.deleteMany({
            where: {
              relatedUserId: subadmin.id,
              type: {
                in: ['TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN'],
              },
            },
          });
          console.log(`  ✅ Eliminadas ${deletedRelatedTransfers.count} transferencias relacionadas con el SUBADMIN`);

          // Resetear saldo de la wallet del SUBADMIN a 0
          await tx.wallet.update({
            where: { id: subadminWallet.id },
            data: { balance: new Prisma.Decimal(0) },
          });
          console.log(`  ✅ Saldo de wallet del SUBADMIN reseteado a 0\n`);
        });
      }
      
      console.log('✅ Limpieza completada exitosamente!\n');
      return;
    }

    // Mostrar información de los managers encontrados
    const softDeletedCount = managers.filter((m) => m.deletedAt !== null).length;
    const activeCount = managers.filter((m) => m.deletedAt === null).length;
    console.log(`  - Managers activos: ${activeCount}`);
    console.log(`  - Managers con soft delete: ${softDeletedCount}\n`);

    // 4. Para cada manager, obtener todos los clientes
    const managerIds = managers.map((m) => m.id);
    const clientManagers = await prisma.clientManager.findMany({
      where: {
        userId: { in: managerIds },
        deletedAt: null,
      },
      select: {
        clientId: true,
        userId: true,
      },
    });

    const clientIds = [...new Set(clientManagers.map((cm) => cm.clientId))];
    console.log(`📋 Encontrados ${clientIds.length} clientes únicos\n`);

    // 5. Obtener todos los préstamos de estos clientes
    const loans = await prisma.loan.findMany({
      where: {
        clientId: { in: clientIds },
        deletedAt: null,
      },
      select: {
        id: true,
        loanTrack: true,
      },
    });

    const loanIds = loans.map((l) => l.id);
    console.log(`📋 Encontrados ${loanIds.length} préstamos\n`);

    // 6. Obtener todos los subloans
    const subLoans = await prisma.subLoan.findMany({
      where: {
        loanId: { in: loanIds },
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    const subLoanIds = subLoans.map((sl) => sl.id);
    console.log(`📋 Encontrados ${subLoanIds.length} subloans\n`);

    // 7. Obtener datos necesarios antes de la transacción
    const dailyClosures = await prisma.dailyClosure.findMany({
      where: {
        userId: { in: managerIds },
      },
      select: { id: true },
    });
    const dailyClosureIds = dailyClosures.map((dc) => dc.id);

    const collectionRoutes = await prisma.dailyCollectionRoute.findMany({
      where: {
        managerId: { in: managerIds },
      },
      select: { id: true },
    });
    const routeIds = collectionRoutes.map((r) => r.id);

    // 8. Iniciar transacción para eliminar todo (con timeout aumentado)
    await prisma.$transaction(
      async (tx) => {
      console.log('🔄 Iniciando eliminación en transacción...\n');

      // 6.1. Eliminar Payments (de subloans)
      const deletedPayments = await tx.payment.deleteMany({
        where: {
          subLoanId: { in: subLoanIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedPayments.count} payments`);

      // 6.2. Eliminar CollectionRouteItems (de subloans)
      const deletedRouteItems = await tx.collectionRouteItem.deleteMany({
        where: {
          subLoanId: { in: subLoanIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedRouteItems.count} collection route items`);

      // 6.3. Eliminar SubLoans
      const deletedSubLoans = await tx.subLoan.deleteMany({
        where: {
          id: { in: subLoanIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedSubLoans.count} subloans`);

      // 6.4. Eliminar Transactions (de loans y clients)
      const deletedTransactions = await tx.transaction.deleteMany({
        where: {
          OR: [
            { loanId: { in: loanIds } },
            { clientId: { in: clientIds } },
          ],
        },
      });
      console.log(`  ✅ Eliminados ${deletedTransactions.count} transactions`);

      // 6.5. Eliminar Loans
      const deletedLoans = await tx.loan.deleteMany({
        where: {
          id: { in: loanIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedLoans.count} loans`);

      // 6.6. Eliminar ClientManagers
      const deletedClientManagers = await tx.clientManager.deleteMany({
        where: {
          userId: { in: managerIds },
          deletedAt: null,
        },
      });
      console.log(`  ✅ Eliminados ${deletedClientManagers.count} client managers`);

      // 6.7. Eliminar Clients
      const deletedClients = await tx.client.deleteMany({
        where: {
          id: { in: clientIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedClients.count} clients`);

      // 6.8. Obtener wallets de collector para resetear saldos
      const collectorWallets = await tx.collectorWallet.findMany({
        where: {
          userId: { in: managerIds },
        },
        select: {
          id: true,
          userId: true,
        },
      });

      const collectorWalletIds = collectorWallets.map((w) => w.id);

      // 6.9. Eliminar CollectorWalletTransactions
      const deletedCollectorWalletTxs = await tx.collectorWalletTransaction.deleteMany({
        where: {
          walletId: { in: collectorWalletIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedCollectorWalletTxs.count} collector wallet transactions`);

      // 6.10. Eliminar CollectorWallets (hard delete)
      const deletedCollectorWallets = await tx.collectorWallet.deleteMany({
        where: {
          id: { in: collectorWalletIds },
        },
      });
      console.log(`  ✅ Eliminados (hard delete) ${deletedCollectorWallets.count} collector wallets`);

      // 6.11. Obtener wallets regulares
      const wallets = await tx.wallet.findMany({
        where: {
          userId: { in: managerIds },
        },
        select: {
          id: true,
          userId: true,
        },
      });

      const walletIds = wallets.map((w) => w.id);

      // 6.12. Eliminar WalletTransactions
      const deletedWalletTxs = await tx.walletTransaction.deleteMany({
        where: {
          walletId: { in: walletIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedWalletTxs.count} wallet transactions`);

      // 6.13. Eliminar Wallets (hard delete)
      const deletedWallets = await tx.wallet.deleteMany({
        where: {
          id: { in: walletIds },
        },
      });
      console.log(`  ✅ Eliminados (hard delete) ${deletedWallets.count} wallets`);

      // 7.1. Eliminar Expenses de DailyClosures primero
      if (dailyClosureIds.length > 0) {
        const deletedExpenses = await tx.expense.deleteMany({
          where: {
            dailyClosureId: { in: dailyClosureIds },
          },
        });
        console.log(`  ✅ Eliminados ${deletedExpenses.count} expenses de daily closures`);
      }

      // 7.2. Eliminar Expenses de CollectionRoutes
      if (routeIds.length > 0) {
        const deletedRouteExpenses = await tx.routeExpense.deleteMany({
          where: {
            routeId: { in: routeIds },
          },
        });
        console.log(`  ✅ Eliminados ${deletedRouteExpenses.count} route expenses`);
      }

      // 7.3. Eliminar DailyCollectionRoutes
      const deletedRoutes = await tx.dailyCollectionRoute.deleteMany({
        where: {
          managerId: { in: managerIds },
        },
      });
      console.log(`  ✅ Eliminadas ${deletedRoutes.count} daily collection routes`);

      // 7.4. Eliminar DailyClosures
      const deletedClosures = await tx.dailyClosure.deleteMany({
        where: {
          userId: { in: managerIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedClosures.count} daily closures`);

      // 7.5. Eliminar ManagerPayments
      const deletedManagerPayments = await tx.managerPayment.deleteMany({
        where: {
          managerId: { in: managerIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedManagerPayments.count} manager payments`);

      // 7.6. Eliminar RefreshTokens de los managers
      const deletedRefreshTokens = await tx.refreshToken.deleteMany({
        where: {
          userId: { in: managerIds },
        },
      });
      console.log(`  ✅ Eliminados ${deletedRefreshTokens.count} refresh tokens`);

      // 7.7. Verificar que no haya usuarios creados por estos managers (debería estar vacío)
      const usersCreatedByManagers = await tx.user.findMany({
        where: {
          createdById: { in: managerIds },
          deletedAt: null,
        },
        select: { id: true },
      });

      if (usersCreatedByManagers.length > 0) {
        console.log(`  ⚠️  Advertencia: Se encontraron ${usersCreatedByManagers.length} usuarios creados por estos managers`);
        console.log(`  ⚠️  Estos usuarios también serán eliminados\n`);
        
        const usersToDelete = usersCreatedByManagers.map((u) => u.id);
        await tx.user.deleteMany({
          where: {
            id: { in: usersToDelete },
          },
        });
        console.log(`  ✅ Eliminados ${usersCreatedByManagers.length} usuarios creados por los managers`);
      }

      // 7.8. Eliminar los managers (hard delete)
      const deletedManagers = await tx.user.deleteMany({
        where: {
          id: { in: managerIds },
        },
      });
      console.log(`  ✅ Eliminados (hard delete) ${deletedManagers.count} managers\n`);
      },
      {
        maxWait: 10000, // 10 segundos máximo de espera
        timeout: 30000, // 30 segundos de timeout para la transacción
      },
    );

    // 8. Actualizar usedClientQuota del SUBADMIN
    // Calcular la suma de todas las clientQuota de los managers eliminados
    const totalManagerQuota = managers.reduce((sum, manager) => sum + manager.clientQuota, 0);
    
    if (totalManagerQuota > 0) {
      console.log('🔄 Actualizando usedClientQuota del SUBADMIN...\n');
      
      const updatedSubadmin = await prisma.user.update({
        where: { id: subadmin.id },
        data: {
          usedClientQuota: {
            decrement: totalManagerQuota,
          },
        },
        select: {
          usedClientQuota: true,
        },
      });
      
      console.log(`  ✅ usedClientQuota actualizado: ${subadmin.usedClientQuota} -> ${updatedSubadmin.usedClientQuota}`);
      console.log(`  ✅ Se restaron ${totalManagerQuota} unidades de cuota\n`);
    }

    // 8.1. Recalcular usedClientQuota basándose en los managers que aún existen
    // Esto asegura que el valor sea correcto incluso si los managers ya fueron eliminados previamente
    console.log('🔄 Recalculando usedClientQuota del SUBADMIN basándose en managers existentes...\n');
    
    const remainingManagers = await prisma.user.findMany({
      where: {
        createdById: subadmin.id,
        role: 'MANAGER',
        deletedAt: null,
      },
      select: {
        clientQuota: true,
      },
    });

    const recalculatedQuota = remainingManagers.reduce((sum, manager) => sum + manager.clientQuota, 0);
    
    const finalSubadmin = await prisma.user.update({
      where: { id: subadmin.id },
      data: {
        usedClientQuota: recalculatedQuota,
      },
      select: {
        usedClientQuota: true,
      },
    });
    
    console.log(`  ✅ usedClientQuota recalculado: ${finalSubadmin.usedClientQuota}`);
    console.log(`  ✅ Basado en ${remainingManagers.length} managers existentes\n`);

    // 9. Limpiar transferencias del SUBADMIN y resetear su wallet
    if (subadminWallet) {
      console.log('🔄 Limpiando transferencias del SUBADMIN...\n');
      
      await prisma.$transaction(async (tx) => {
        // Eliminar transferencias del SUBADMIN (TRANSFER_TO_MANAGER y TRANSFER_FROM_SUBADMIN)
        const deletedSubadminTransfers = await tx.walletTransaction.deleteMany({
          where: {
            walletId: subadminWallet.id,
            type: {
              in: ['TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN'],
            },
          },
        });
        console.log(`  ✅ Eliminadas ${deletedSubadminTransfers.count} transferencias del SUBADMIN`);

        // Eliminar transferencias relacionadas con el SUBADMIN (donde relatedUserId es el subadmin)
        const deletedRelatedTransfers = await tx.walletTransaction.deleteMany({
          where: {
            relatedUserId: subadmin.id,
            type: {
              in: ['TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN'],
            },
          },
        });
        console.log(`  ✅ Eliminadas ${deletedRelatedTransfers.count} transferencias relacionadas con el SUBADMIN`);

        // Resetear saldo de la wallet del SUBADMIN a 0
        await tx.wallet.update({
          where: { id: subadminWallet.id },
          data: { balance: new Prisma.Decimal(0) },
        });
        console.log(`  ✅ Saldo de wallet del SUBADMIN reseteado a 0\n`);
      });
    }

    console.log('✅ Limpieza completada exitosamente!\n');

    // Obtener conteo de wallets para el resumen
    const collectorWalletsCount = await prisma.collectorWallet.count({
      where: {
        userId: { in: managerIds },
      },
    });

    const walletsCount = await prisma.wallet.count({
      where: {
        userId: { in: managerIds },
      },
    });

    // Resumen final
    console.log('📊 RESUMEN:');
    console.log(`  - Managers procesados: ${managers.length}`);
    console.log(`  - Clientes eliminados: ${clientIds.length}`);
    console.log(`  - Préstamos eliminados: ${loanIds.length}`);
    console.log(`  - Wallets reseteados: ${collectorWalletsCount + walletsCount}\n`);
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar el script
const subadminEmail = 'subadmin@test.com';

cleanupSubadminData(subadminEmail)
  .then(() => {
    console.log('✨ Script ejecutado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });

