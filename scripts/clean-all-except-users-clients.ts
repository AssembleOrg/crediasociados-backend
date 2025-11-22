import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanAllExceptUsersAndClients() {
  console.log('🧹 Iniciando limpieza completa de la base de datos...');
  console.log('📌 Se mantendrán: Usuarios y Clientes\n');

  try {
    // 1. Eliminar transacciones de Safe (caja fuerte)
    console.log('1️⃣ Eliminando transacciones de Safe...');
    const safeTransactions = await prisma.safeTransaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${safeTransactions.count} transacciones de Safe`);

    // 2. Eliminar gastos de Safe (categorías)
    console.log('2️⃣ Eliminando gastos de Safe (categorías)...');
    const safeExpenses = await prisma.safeExpense.deleteMany({});
    console.log(`   ✅ Eliminados ${safeExpenses.count} gastos de Safe`);

    // 3. Eliminar Safes (cajas fuertes)
    console.log('3️⃣ Eliminando Safes (cajas fuertes)...');
    const safes = await prisma.safe.deleteMany({});
    console.log(`   ✅ Eliminadas ${safes.count} cajas fuertes`);

    // 4. Eliminar transacciones de collector wallet
    console.log('4️⃣ Eliminando transacciones de collector wallet...');
    const collectorWalletTxs = await prisma.collectorWalletTransaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${collectorWalletTxs.count} transacciones de collector wallet`);

    // 5. Eliminar collector wallets
    console.log('5️⃣ Eliminando collector wallets...');
    const collectorWallets = await prisma.collectorWallet.deleteMany({});
    console.log(`   ✅ Eliminadas ${collectorWallets.count} collector wallets`);

    // 6. Eliminar transacciones de wallet principal
    console.log('6️⃣ Eliminando transacciones de wallet principal...');
    const walletTxs = await prisma.walletTransaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${walletTxs.count} transacciones de wallet principal`);

    // 7. Eliminar wallets principales
    console.log('7️⃣ Eliminando wallets principales...');
    const wallets = await prisma.wallet.deleteMany({});
    console.log(`   ✅ Eliminadas ${wallets.count} wallets principales`);

    // 8. Eliminar pagos
    console.log('8️⃣ Eliminando pagos...');
    const payments = await prisma.payment.deleteMany({});
    console.log(`   ✅ Eliminados ${payments.count} pagos`);

    // 9. Eliminar transacciones (Transaction)
    console.log('9️⃣ Eliminando transacciones (Transaction)...');
    const transactions = await prisma.transaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${transactions.count} transacciones`);

    // 10. Eliminar items de ruta de cobro
    console.log('🔟 Eliminando items de ruta de cobro...');
    const routeItems = await prisma.collectionRouteItem.deleteMany({});
    console.log(`   ✅ Eliminados ${routeItems.count} items de ruta`);

    // 11. Eliminar gastos de ruta
    console.log('1️⃣1️⃣ Eliminando gastos de ruta...');
    const routeExpenses = await prisma.routeExpense.deleteMany({});
    console.log(`   ✅ Eliminados ${routeExpenses.count} gastos de ruta`);

    // 12. Eliminar rutas de cobro del día
    console.log('1️⃣2️⃣ Eliminando rutas de cobro del día...');
    const collectionRoutes = await prisma.dailyCollectionRoute.deleteMany({});
    console.log(`   ✅ Eliminadas ${collectionRoutes.count} rutas de cobro`);

    // 13. Eliminar gastos (Expense)
    console.log('1️⃣3️⃣ Eliminando gastos (Expense)...');
    const expenses = await prisma.expense.deleteMany({});
    console.log(`   ✅ Eliminados ${expenses.count} gastos`);

    // 14. Eliminar cierres diarios
    console.log('1️⃣4️⃣ Eliminando cierres diarios...');
    const dailyClosures = await prisma.dailyClosure.deleteMany({});
    console.log(`   ✅ Eliminados ${dailyClosures.count} cierres diarios`);

    // 15. Eliminar pagos de manager
    console.log('1️⃣5️⃣ Eliminando pagos de manager...');
    const managerPayments = await prisma.managerPayment.deleteMany({});
    console.log(`   ✅ Eliminados ${managerPayments.count} pagos de manager`);

    // 16. Eliminar subpréstamos
    console.log('1️⃣6️⃣ Eliminando subpréstamos...');
    const subLoans = await prisma.subLoan.deleteMany({});
    console.log(`   ✅ Eliminados ${subLoans.count} subpréstamos`);

    // 17. Eliminar préstamos
    console.log('1️⃣7️⃣ Eliminando préstamos...');
    const loans = await prisma.loan.deleteMany({});
    console.log(`   ✅ Eliminados ${loans.count} préstamos`);

    // 18. Eliminar secuencias de préstamos
    console.log('1️⃣8️⃣ Eliminando secuencias de préstamos...');
    const loanSequences = await prisma.loanSequence.deleteMany({});
    console.log(`   ✅ Eliminadas ${loanSequences.count} secuencias de préstamos`);

    // 19. Eliminar logs de auditoría
    console.log('1️⃣9️⃣ Eliminando logs de auditoría...');
    const auditLogs = await prisma.auditLog.deleteMany({});
    console.log(`   ✅ Eliminados ${auditLogs.count} logs de auditoría`);

    // 20. Eliminar logs HTTP
    console.log('2️⃣0️⃣ Eliminando logs HTTP...');
    const httpLogs = await prisma.httpLog.deleteMany({});
    console.log(`   ✅ Eliminados ${httpLogs.count} logs HTTP`);

    // 21. Eliminar respuestas de API externa
    console.log('2️⃣1️⃣ Eliminando respuestas de API externa...');
    const apiResponses = await prisma.externalApiResponse.deleteMany({});
    console.log(`   ✅ Eliminadas ${apiResponses.count} respuestas de API externa`);

    // 22. Eliminar refresh tokens
    console.log('2️⃣2️⃣ Eliminando refresh tokens...');
    const refreshTokens = await prisma.refreshToken.deleteMany({});
    console.log(`   ✅ Eliminados ${refreshTokens.count} refresh tokens`);

    console.log('\n✨ Limpieza completada exitosamente!');
    console.log('\n📊 Resumen:');
    console.log(`   - Transacciones de Safe: ${safeTransactions.count}`);
    console.log(`   - Gastos de Safe: ${safeExpenses.count}`);
    console.log(`   - Safes: ${safes.count}`);
    console.log(`   - Transacciones de collector wallet: ${collectorWalletTxs.count}`);
    console.log(`   - Collector wallets: ${collectorWallets.count}`);
    console.log(`   - Transacciones de wallet principal: ${walletTxs.count}`);
    console.log(`   - Wallets principales: ${wallets.count}`);
    console.log(`   - Pagos: ${payments.count}`);
    console.log(`   - Transacciones: ${transactions.count}`);
    console.log(`   - Items de ruta: ${routeItems.count}`);
    console.log(`   - Gastos de ruta: ${routeExpenses.count}`);
    console.log(`   - Rutas de cobro: ${collectionRoutes.count}`);
    console.log(`   - Gastos: ${expenses.count}`);
    console.log(`   - Cierres diarios: ${dailyClosures.count}`);
    console.log(`   - Pagos de manager: ${managerPayments.count}`);
    console.log(`   - Subpréstamos: ${subLoans.count}`);
    console.log(`   - Préstamos: ${loans.count}`);
    console.log(`   - Secuencias: ${loanSequences.count}`);
    console.log(`   - Logs de auditoría: ${auditLogs.count}`);
    console.log(`   - Logs HTTP: ${httpLogs.count}`);
    console.log(`   - Respuestas de API: ${apiResponses.count}`);
    console.log(`   - Refresh tokens: ${refreshTokens.count}`);
    console.log('\n✅ Usuarios y Clientes se mantienen intactos.');
    console.log('✅ ClientManager (relaciones) se mantienen intactos.');

  } catch (error: any) {
    console.error('\n❌ Error durante la limpieza:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await cleanAllExceptUsersAndClients();
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

