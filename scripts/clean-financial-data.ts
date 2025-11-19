import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares/blue';

interface DolarApiResponse {
  compra: number;
  venta: number;
  casa: string;
  nombre: string;
  moneda: string;
  fechaActualizacion: string;
}

async function fetchDolarPrice(): Promise<void> {
  console.log('🔄 Obteniendo precio del dólar desde la API externa...');
  
  try {
    const response = await axios.get<DolarApiResponse>(DOLAR_API_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'CrediAsociados-Backend/1.0.0',
        Accept: 'application/json',
      },
    });

    const responseTime = Date.now();

    await prisma.externalApiResponse.create({
      data: {
        compra: response.data.compra,
        venta: response.data.venta,
        casa: response.data.casa,
        nombre: response.data.nombre,
        moneda: response.data.moneda,
        fechaActualizacion: response.data.fechaActualizacion,
        apiUrl: DOLAR_API_URL,
        status: 'SUCCESS',
        responseTime: 0, // No medimos el tiempo en el script
      },
    });

    console.log(`✅ Precio del dólar guardado: Compra: $${response.data.compra}, Venta: $${response.data.venta}`);
  } catch (error: any) {
    console.error('❌ Error al obtener el precio del dólar:', error.message);
    
    // Guardar el error también
    await prisma.externalApiResponse.create({
      data: {
        compra: 0,
        venta: 0,
        casa: 'error',
        nombre: 'Error',
        moneda: 'USD',
        fechaActualizacion: new Date().toISOString(),
        apiUrl: DOLAR_API_URL,
        status: 'ERROR',
        responseTime: 0,
      },
    });
    
    throw error;
  }
}

async function cleanFinancialData() {
  console.log('🧹 Iniciando limpieza de datos financieros...\n');

  try {
    // 1. Eliminar transacciones de collector wallet
    console.log('1️⃣ Eliminando transacciones de collector wallet...');
    const collectorWalletTxs = await prisma.collectorWalletTransaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${collectorWalletTxs.count} transacciones de collector wallet`);

    // 2. Eliminar transacciones de wallet principal
    console.log('2️⃣ Eliminando transacciones de wallet principal...');
    const walletTxs = await prisma.walletTransaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${walletTxs.count} transacciones de wallet principal`);

    // 3. Eliminar pagos
    console.log('3️⃣ Eliminando pagos...');
    const payments = await prisma.payment.deleteMany({});
    console.log(`   ✅ Eliminados ${payments.count} pagos`);

    // 4. Eliminar transacciones (Transaction)
    console.log('4️⃣ Eliminando transacciones (Transaction)...');
    const transactions = await prisma.transaction.deleteMany({});
    console.log(`   ✅ Eliminadas ${transactions.count} transacciones`);

    // 5. Eliminar items de ruta de cobro
    console.log('5️⃣ Eliminando items de ruta de cobro...');
    const routeItems = await prisma.collectionRouteItem.deleteMany({});
    console.log(`   ✅ Eliminados ${routeItems.count} items de ruta`);

    // 6. Eliminar gastos de ruta
    console.log('6️⃣ Eliminando gastos de ruta...');
    const routeExpenses = await prisma.routeExpense.deleteMany({});
    console.log(`   ✅ Eliminados ${routeExpenses.count} gastos de ruta`);

    // 7. Eliminar rutas de cobro del día
    console.log('7️⃣ Eliminando rutas de cobro del día...');
    const collectionRoutes = await prisma.dailyCollectionRoute.deleteMany({});
    console.log(`   ✅ Eliminadas ${collectionRoutes.count} rutas de cobro`);

    // 8. Eliminar gastos (Expense)
    console.log('8️⃣ Eliminando gastos (Expense)...');
    const expenses = await prisma.expense.deleteMany({});
    console.log(`   ✅ Eliminados ${expenses.count} gastos`);

    // 9. Eliminar cierres diarios
    console.log('9️⃣ Eliminando cierres diarios...');
    const dailyClosures = await prisma.dailyClosure.deleteMany({});
    console.log(`   ✅ Eliminados ${dailyClosures.count} cierres diarios`);

    // 10. Eliminar pagos de manager
    console.log('🔟 Eliminando pagos de manager...');
    const managerPayments = await prisma.managerPayment.deleteMany({});
    console.log(`   ✅ Eliminados ${managerPayments.count} pagos de manager`);

    // 11. Eliminar subpréstamos
    console.log('1️⃣1️⃣ Eliminando subpréstamos...');
    const subLoans = await prisma.subLoan.deleteMany({});
    console.log(`   ✅ Eliminados ${subLoans.count} subpréstamos`);

    // 12. Eliminar préstamos
    console.log('1️⃣2️⃣ Eliminando préstamos...');
    const loans = await prisma.loan.deleteMany({});
    console.log(`   ✅ Eliminados ${loans.count} préstamos`);

    // 13. Resetear balances de collector wallets
    console.log('1️⃣3️⃣ Reseteando balances de collector wallets...');
    const collectorWallets = await prisma.collectorWallet.updateMany({
      data: { balance: 0 },
    });
    console.log(`   ✅ Reseteados ${collectorWallets.count} balances de collector wallets`);

    // 14. Resetear balances de wallets principales
    console.log('1️⃣4️⃣ Reseteando balances de wallets principales...');
    const wallets = await prisma.wallet.updateMany({
      data: { balance: 0 },
    });
    console.log(`   ✅ Reseteados ${wallets.count} balances de wallets principales`);

    // 15. Eliminar secuencias de préstamos
    console.log('1️⃣5️⃣ Eliminando secuencias de préstamos...');
    const loanSequences = await prisma.loanSequence.deleteMany({});
    console.log(`   ✅ Eliminadas ${loanSequences.count} secuencias de préstamos`);

    // 16. Obtener precio del dólar
    console.log('\n1️⃣6️⃣ Obteniendo precio del dólar...');
    await fetchDolarPrice();

    console.log('\n✨ Limpieza completada exitosamente!');
    console.log('\n📊 Resumen:');
    console.log(`   - Transacciones de collector wallet: ${collectorWalletTxs.count}`);
    console.log(`   - Transacciones de wallet principal: ${walletTxs.count}`);
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
    console.log(`   - Wallets reseteadas: ${wallets.count + collectorWallets.count}`);
    console.log(`   - Secuencias eliminadas: ${loanSequences.count}`);
    console.log('\n✅ Clientes y usuarios se mantienen intactos.');

  } catch (error: any) {
    console.error('\n❌ Error durante la limpieza:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await cleanFinancialData();
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

