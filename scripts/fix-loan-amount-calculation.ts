import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Corrige los préstamos donde amount y originalAmount son iguales
 * Recalcula amount como originalAmount * (1 + baseInterestRate)
 */
async function fixLoanAmountCalculation() {
  console.log('Buscando préstamos con amount y originalAmount iguales...\n');

  // Obtener todos los préstamos que no están eliminados
  const loans = await prisma.loan.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total de préstamos encontrados: ${loans.length}\n`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const loan of loans) {
    const originalAmount = Number(loan.originalAmount);
    const currentAmount = Number(loan.amount);
    const baseInterestRate = Number(loan.baseInterestRate);

    // Verificar si amount y originalAmount son iguales (o muy cercanos por redondeo)
    const difference = Math.abs(currentAmount - originalAmount);
    const tolerance = 0.01; // Tolerancia de 1 centavo para redondeo

    if (difference <= tolerance) {
      // Calcular el amount correcto
      const correctAmount = originalAmount * (1 + baseInterestRate);

      try {
        await prisma.loan.update({
          where: { id: loan.id },
          data: {
            amount: new Prisma.Decimal(correctAmount.toFixed(2)),
          },
        });

        console.log(
          `✅ Corregido préstamo ${loan.loanTrack}:`,
          `originalAmount=${originalAmount.toFixed(2)},`,
          `amount anterior=${currentAmount.toFixed(2)},`,
          `amount nuevo=${correctAmount.toFixed(2)}`,
          `(interés: ${(baseInterestRate * 100).toFixed(2)}%)`,
        );
        fixed++;
      } catch (error) {
        console.error(
          `❌ Error al corregir préstamo ${loan.loanTrack}:`,
          error instanceof Error ? error.message : error,
        );
        errors++;
      }
    } else {
      // El préstamo ya tiene el amount correcto
      skipped++;
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Total de préstamos procesados: ${loans.length}`);
  console.log(`Préstamos corregidos: ${fixed}`);
  console.log(`Préstamos ya correctos (saltados): ${skipped}`);
  console.log(`Errores: ${errors}`);
}

async function main() {
  try {
    await fixLoanAmountCalculation();
  } catch (error) {
    console.error('Error en el script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

