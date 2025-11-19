import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { DateTime, Settings } from 'luxon';

// Configurar Luxon para usar la zona horaria de Buenos Aires
Settings.defaultZone = 'America/Argentina/Buenos_Aires';

const prisma = new PrismaClient();

async function createNovemberRoutes() {
  console.log('\n🚀 Iniciando creación de rutas para noviembre 2025 (17/11 - 30/11)...\n');

  try {
    const startDate = DateTime.fromObject({ year: 2025, month: 11, day: 17 }).startOf('day');
    const endDate = DateTime.fromObject({ year: 2025, month: 11, day: 30 }).startOf('day');

    const allCreatedRoutes: any[] = [];
    const dailySummaries: any[] = [];

      // Iterar día por día desde el 17 de noviembre hasta el 30
    let currentDate = startDate;
    while (currentDate <= endDate) {
      const dayStart = currentDate.startOf('day').toJSDate();
      const dayEnd = currentDate.endOf('day').toJSDate();

      console.log(`📅 Procesando rutas para fecha: ${currentDate.toFormat('dd/MM/yyyy')}`);

      // Obtener todos los managers con subloans que vencen en este día
      const managersWithSubLoans = await prisma.user.findMany({
        where: {
          role: 'MANAGER',
          deletedAt: null,
          managedClients: {
            some: {
              deletedAt: null,
              client: {
                deletedAt: null,
                loans: {
                  some: {
                    deletedAt: null,
                    status: { in: ['ACTIVE', 'APPROVED'] },
                    subLoans: {
                      some: {
                        deletedAt: null,
                        dueDate: {
                          gte: dayStart,
                          lte: dayEnd,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        select: {
          id: true,
          fullName: true,
        },
      });

      const dayRoutes: any[] = [];

      for (const manager of managersWithSubLoans) {
        try {
          // Verificar si ya existe una ruta para este manager en esta fecha
          const existingRoute = await prisma.dailyCollectionRoute.findFirst({
            where: {
              managerId: manager.id,
              routeDate: dayStart,
            },
          });

          if (existingRoute) {
            console.log(
              `  ⚠️  Ruta ya existe para manager ${manager.fullName} en fecha ${currentDate.toFormat('dd/MM/yyyy')}`,
            );
            continue;
          }

          // Obtener subloans que vencen en este día para este manager
          const subLoans = await prisma.subLoan.findMany({
            where: {
              deletedAt: null,
              dueDate: {
                gte: dayStart,
                lte: dayEnd,
              },
              loan: {
                deletedAt: null,
                status: { in: ['ACTIVE', 'APPROVED'] },
                client: {
                  deletedAt: null,
                  managers: {
                    some: {
                      userId: manager.id,
                      deletedAt: null,
                    },
                  },
                },
              },
            },
            include: {
              loan: {
                include: {
                  client: {
                    select: {
                      id: true,
                      fullName: true,
                      phone: true,
                      address: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              dueDate: 'asc',
            },
          });

          if (subLoans.length === 0) {
            console.log(
              `  ℹ️  No hay subloans para manager ${manager.fullName} en fecha ${currentDate.toFormat('dd/MM/yyyy')}`,
            );
            continue;
          }

          // Crear la ruta con sus items
          const route = await prisma.$transaction(async (tx) => {
            const newRoute = await tx.dailyCollectionRoute.create({
              data: {
                managerId: manager.id,
                routeDate: dayStart,
                status: 'ACTIVE',
                totalCollected: new Decimal(0),
                totalExpenses: new Decimal(0),
                netAmount: new Decimal(0),
              },
            });

            // Crear items de la ruta
            const itemsData = subLoans.map((subLoan, index) => ({
              routeId: newRoute.id,
              subLoanId: subLoan.id,
              clientName: subLoan.loan.client.fullName,
              clientPhone: subLoan.loan.client.phone,
              clientAddress: subLoan.loan.client.address,
              orderIndex: index,
              amountCollected: new Decimal(0),
            }));

            await tx.collectionRouteItem.createMany({
              data: itemsData,
            });

            return newRoute;
          });

          const routeInfo = {
            managerId: manager.id,
            managerName: manager.fullName,
            routeId: route.id,
            itemsCount: subLoans.length,
            date: currentDate.toFormat('dd/MM/yyyy'),
          };

          dayRoutes.push(routeInfo);
          allCreatedRoutes.push(routeInfo);

          console.log(
            `  ✅ Ruta creada para manager ${manager.fullName} con ${subLoans.length} items`,
          );
        } catch (error: any) {
          console.error(
            `  ❌ Error creando ruta para manager ${manager.fullName} en fecha ${currentDate.toFormat('dd/MM/yyyy')}:`,
            error.message,
          );
        }
      }

      dailySummaries.push({
        date: currentDate.toFormat('dd/MM/yyyy'),
        routesCreated: dayRoutes.length,
        routes: dayRoutes,
      });

      // Avanzar al siguiente día
      currentDate = currentDate.plus({ days: 1 });
    }

    console.log('\n✅ Resultado:');
    console.log(`  - Total de rutas creadas: ${allCreatedRoutes.length}`);
    console.log(`  - Período: ${startDate.toFormat('dd/MM/yyyy')} - ${endDate.toFormat('dd/MM/yyyy')}`);
    console.log(`  - Días procesados: ${dailySummaries.length}`);

    if (dailySummaries.length > 0) {
      console.log('\n📅 Resumen por día:');
      dailySummaries.forEach((summary: any) => {
        if (summary.routesCreated > 0) {
          console.log(`  - ${summary.date}: ${summary.routesCreated} ruta(s) creada(s)`);
        }
      }); 
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
createNovemberRoutes()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });
