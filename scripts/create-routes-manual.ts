import { PrismaClient } from '@prisma/client';
import { DateTime, Settings } from 'luxon';

// Configurar zona horaria de Argentina (GMT-3)
Settings.defaultZone = 'America/Argentina/Buenos_Aires';

const prisma = new PrismaClient();

async function createDailyRoutes() {
  console.log('🚀 Iniciando creación manual de rutas de cobro...\n');

  // Usar zona horaria de Argentina (GMT-3)
  const todayStart = DateTime.now().startOf('day').toJSDate();
  const endOfDay = DateTime.now().endOf('day').toJSDate();

  console.log(`📅 Fecha: ${todayStart.toISOString()}\n`);

  // Obtener managers con subloans que vencen hoy
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
                      gte: todayStart,
                      lte: endOfDay,
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
      email: true,
    },
  });

  console.log(`👥 Managers con subloans para hoy: ${managersWithSubLoans.length}\n`);

  if (managersWithSubLoans.length === 0) {
    console.log('⚠️  No hay managers con subloans que vencen hoy.');
    console.log('✅ Finalizado.');
    await prisma.$disconnect();
    return;
  }

  const createdRoutes: any[] = [];

  for (const manager of managersWithSubLoans) {
    try {
      console.log(`\n📋 Procesando manager: ${manager.fullName} (${manager.email})`);

      // Verificar si ya existe una ruta
      const existingRoute = await prisma.dailyCollectionRoute.findFirst({
        where: {
          managerId: manager.id,
          routeDate: todayStart,
        },
      });

      if (existingRoute) {
        console.log(`  ⚠️  Ya existe una ruta para este manager hoy (ID: ${existingRoute.id})`);
        continue;
      }

      // Obtener subloans
      const subLoans = await prisma.subLoan.findMany({
        where: {
          deletedAt: null,
          dueDate: {
            gte: todayStart,
            lte: endOfDay,
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

      console.log(`  📦 SubLoans encontrados: ${subLoans.length}`);

      if (subLoans.length === 0) {
        console.log(`  ℹ️  No hay subloans activos para este manager`);
        continue;
      }

      // Crear la ruta
      const route = await prisma.$transaction(async (tx) => {
        const newRoute = await tx.dailyCollectionRoute.create({
          data: {
            managerId: manager.id,
            routeDate: todayStart,
            status: 'ACTIVE',
            totalCollected: 0,
            totalExpenses: 0,
            netAmount: 0,
          },
        });

        // Crear items
        const itemsData = subLoans.map((subLoan, index) => ({
          routeId: newRoute.id,
          subLoanId: subLoan.id,
          clientName: subLoan.loan.client.fullName,
          clientPhone: subLoan.loan.client.phone,
          clientAddress: subLoan.loan.client.address,
          orderIndex: index,
          amountCollected: 0,
        }));

        await tx.collectionRouteItem.createMany({
          data: itemsData,
        });

        return newRoute;
      });

      createdRoutes.push({
        managerId: manager.id,
        managerName: manager.fullName,
        managerEmail: manager.email,
        routeId: route.id,
        itemsCount: subLoans.length,
      });

      console.log(`  ✅ Ruta creada exitosamente (ID: ${route.id})`);
      console.log(`  📊 Items en la ruta: ${subLoans.length}`);
    } catch (error: any) {
      console.error(`  ❌ Error creando ruta para ${manager.fullName}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE EJECUCIÓN');
  console.log('='.repeat(60));
  console.log(`✅ Rutas creadas: ${createdRoutes.length}`);
  console.log(`📅 Fecha: ${todayStart.toLocaleDateString('es-AR')}`);
  
  if (createdRoutes.length > 0) {
    console.log('\n📋 Detalle de rutas creadas:');
    createdRoutes.forEach((route, index) => {
      console.log(`\n  ${index + 1}. ${route.managerName}`);
      console.log(`     Email: ${route.managerEmail}`);
      console.log(`     Route ID: ${route.routeId}`);
      console.log(`     Items: ${route.itemsCount} subloans`);
    });
  }

  console.log('\n✅ Proceso completado exitosamente!\n');

  await prisma.$disconnect();
}

createDailyRoutes()
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

