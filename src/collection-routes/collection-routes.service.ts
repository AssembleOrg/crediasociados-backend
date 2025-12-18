import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, Prisma } from '@prisma/client';
import {
  CloseRouteDto,
  UpdateRouteOrderDto,
  GetRoutesQueryDto,
  CollectionRouteResponseDto,
  CreateRouteExpenseDto,
  UpdateRouteExpenseDto,
  RouteExpenseResponseDto,
} from './dto';
import { Decimal } from '@prisma/client/runtime/library';
import { DateUtil } from '../common/utils/date.util';
import { CollectorWalletService } from '../collector-wallet/collector-wallet.service';

@Injectable()
export class CollectionRoutesService {
  private readonly logger = new Logger(CollectionRoutesService.name);

  constructor(
    private prisma: PrismaService,
    private collectorWalletService: CollectorWalletService,
  ) {}

  /**
   * Crear rutas de cobro para todos los managers con subloans activos para hoy
   * Se ejecuta automáticamente a las 4:15 AM
   */
  async createDailyRoutes(): Promise<any> {
    // Usar zona horaria de Argentina (GMT-3)
    const todayStart = DateUtil.now().startOf('day').toJSDate();
    const endOfDay = DateUtil.now().endOf('day').toJSDate();

    // Obtener todos los managers con subloans que vencen hoy
    const managersWithSubLoans = await this.prisma.user.findMany({
      where: {
        role: UserRole.MANAGER,
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
      },
    });

    const createdRoutes: any[] = [];

    for (const manager of managersWithSubLoans) {
      try {
        // Verificar si ya existe una ruta para este manager en esta fecha
        const existingRoute = await this.prisma.dailyCollectionRoute.findFirst({
          where: {
            managerId: manager.id,
            routeDate: todayStart,
          },
        });

        if (existingRoute) {
          this.logger.log(
            `Ruta ya existe para manager ${manager.fullName} en fecha ${todayStart.toISOString()}`,
          );
          continue;
        }

        // Obtener subloans que vencen hoy para este manager
        const subLoans = await this.prisma.subLoan.findMany({
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
          this.logger.log(
            `No hay subloans para manager ${manager.fullName} en fecha ${todayStart.toISOString()}`,
          );
          continue;
        }

        // Crear la ruta con sus items
        const route = await this.prisma.$transaction(async (tx) => {
          const newRoute = await tx.dailyCollectionRoute.create({
            data: {
              managerId: manager.id,
              routeDate: todayStart,
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

        createdRoutes.push({
          managerId: manager.id,
          managerName: manager.fullName,
          routeId: route.id,
          itemsCount: subLoans.length,
        });

        this.logger.log(
          `Ruta creada para manager ${manager.fullName} con ${subLoans.length} items`,
        );
      } catch (error: any) {
        this.logger.error(
          `Error creando ruta para manager ${manager.fullName}:`,
          error,
        );
      }
    }

    return {
      message: `Se crearon ${createdRoutes.length} rutas de cobro`,
      createdRoutes,
      date: todayStart,
    };
  }

  /**
   * Crear rutas de cobro para un período de fechas (desde el 15 de noviembre hasta el 30 de noviembre de 2025)
   * Útil para testing y simulación de rutas históricas
   */
  async createDailyRoutesForNovember(): Promise<any> {
    const startDate = DateUtil.fromObject({ year: 2025, month: 11, day: 15 }).startOf('day');
    const endDate = DateUtil.fromObject({ year: 2025, month: 11, day: 30 }).startOf('day');

    const allCreatedRoutes: any[] = [];
    const dailySummaries: any[] = [];

    // Iterar día por día desde el 15 de noviembre hasta hoy
    let currentDate = startDate;
    while (currentDate <= endDate) {
      const dayStart = currentDate.startOf('day').toJSDate();
      const dayEnd = currentDate.endOf('day').toJSDate();

      this.logger.log(`Procesando rutas para fecha: ${DateUtil.format(currentDate, 'dd/MM/yyyy')}`);

      // Obtener todos los managers con subloans que vencen en este día
      const managersWithSubLoans = await this.prisma.user.findMany({
        where: {
          role: UserRole.MANAGER,
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
          const existingRoute = await this.prisma.dailyCollectionRoute.findFirst({
            where: {
              managerId: manager.id,
              routeDate: dayStart,
            },
          });

          if (existingRoute) {
            this.logger.log(
              `Ruta ya existe para manager ${manager.fullName} en fecha ${DateUtil.format(currentDate, 'dd/MM/yyyy')}`,
            );
            continue;
          }

          // Obtener subloans que vencen en este día para este manager
          const subLoans = await this.prisma.subLoan.findMany({
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
            this.logger.log(
              `No hay subloans para manager ${manager.fullName} en fecha ${DateUtil.format(currentDate, 'dd/MM/yyyy')}`,
            );
            continue;
          }

          // Crear la ruta con sus items
          const route = await this.prisma.$transaction(async (tx) => {
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
            date: DateUtil.format(currentDate, 'dd/MM/yyyy'),
          };

          dayRoutes.push(routeInfo);
          allCreatedRoutes.push(routeInfo);

          this.logger.log(
            `Ruta creada para manager ${manager.fullName} con ${subLoans.length} items en fecha ${DateUtil.format(currentDate, 'dd/MM/yyyy')}`,
          );
        } catch (error: any) {
          this.logger.error(
            `Error creando ruta para manager ${manager.fullName} en fecha ${DateUtil.format(currentDate, 'dd/MM/yyyy')}:`,
            error,
          );
        }
      }

      dailySummaries.push({
        date: DateUtil.format(currentDate, 'dd/MM/yyyy'),
        routesCreated: dayRoutes.length,
        routes: dayRoutes,
      });

      // Avanzar al siguiente día
      currentDate = currentDate.plus({ days: 1 });
    }

    return {
      message: `Se crearon ${allCreatedRoutes.length} rutas de cobro para el período del 15 al 30 de noviembre de 2025`,
      totalRoutesCreated: allCreatedRoutes.length,
      period: {
        start: DateUtil.format(startDate, 'dd/MM/yyyy'),
        end: DateUtil.format(endDate, 'dd/MM/yyyy'),
      },
      dailySummaries,
      allCreatedRoutes,
    };
  }

  /**
   * Obtener la ruta activa del día para un manager
   */
  async getTodayActiveRoute(
    userId: string,
    userRole: UserRole,
    managerId?: string,
  ): Promise<CollectionRouteResponseDto> {
    // Usar zona horaria de Argentina (GMT-3)
    console.table({ userId, userRole, managerId });
    const today = DateUtil.now().startOf('day').toJSDate();

    // Determinar el manager ID a buscar
    let targetManagerId = userId;
    if (managerId && (userRole === UserRole.SUBADMIN || userRole === UserRole.ADMIN || userRole === UserRole.SUPERADMIN)) {
      // Verificar que el manager existe y está bajo el subadmin
      const manager = await this.prisma.user.findFirst({
        where: {
          id: managerId,
          role: UserRole.MANAGER,
          deletedAt: null,
          ...(userRole === UserRole.SUBADMIN
            ? { createdById: userId }
            : {}),
        },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado o sin acceso');
      }

      targetManagerId = managerId;
    } else if (userRole !== UserRole.MANAGER) {
      throw new BadRequestException(
        'Debe especificar un managerId para este rol',
      );
    }

    const route = await this.prisma.dailyCollectionRoute.findFirst({
      where: {
        managerId: targetManagerId,
        routeDate: today, // Esta variable ya está correctamente definida como DateUtil.now().startOf('day').toJSDate()
        // OR: [
        //   { status: 'ACTIVE' },
        //   { status: 'CLOSED' },
        // ],
      },
      include: {
        items: {
          include: {
            subLoan: {
              include: {
                loan: {
                  select: {
                    loanTrack: true,
                    amount: true,
                    currency: true,
                  },
                },
              },
            },
          },
          orderBy: {
            orderIndex: 'asc',
          },
        },
        expenses: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!route) {
      throw new NotFoundException(
        'No hay ruta activa para hoy. Se creará automáticamente a las 4:15 AM',
      );
    }

    return await this.transformRouteToDto(route);
  }

  /**
   * Obtener todas las rutas con filtros
   */
  async getRoutes(
    userId: string,
    userRole: UserRole,
    query: GetRoutesQueryDto,
  ): Promise<CollectionRouteResponseDto[]> {
    const where: any = {};

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      where.managerId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      if (query.managerId) {
        // Verificar que el manager está bajo este subadmin
        const manager = await this.prisma.user.findFirst({
          where: {
            id: query.managerId,
            role: UserRole.MANAGER,
            createdById: userId,
            deletedAt: null,
          },
        });

        if (!manager) {
          throw new ForbiddenException(
            'No tienes acceso a las rutas de este manager',
          );
        }

        where.managerId = query.managerId;
      } else {
        // Obtener todos los managers bajo este subadmin
        const managers = await this.prisma.user.findMany({
          where: {
            role: UserRole.MANAGER,
            createdById: userId,
            deletedAt: null,
          },
          select: { id: true },
        });

        where.managerId = { in: managers.map((m) => m.id) };
      }
    } else if (query.managerId) {
      where.managerId = query.managerId;
    }

    // Filtro de estado
    if (query.status) {
      where.status = query.status;
    }

    // Filtros de fecha
    // IMPORTANTE: routeDate se guarda como inicio del día en Buenos Aires (00:00:00 GMT-3 = 03:00:00 UTC)
    // Cuando se busca por fecha, comparamos desde el inicio del día hasta el final del día en hora argentina
    if (query.dateFrom || query.dateTo) {
      where.routeDate = {};
      if (query.dateFrom) {
        // Extraer solo la fecha (YYYY-MM-DD) si viene con hora
        const dateFromStr = query.dateFrom.includes('T') 
          ? query.dateFrom.split('T')[0]
          : query.dateFrom;
        
        // Crear inicio del día en Buenos Aires (00:00:00 GMT-3 = 03:00:00 UTC)
        const [year, month, day] = dateFromStr.split('-').map(Number);
        const dateFromDT = DateUtil.fromObject({
          year,
          month,
          day,
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
        });
        const dateFrom = dateFromDT.toJSDate();
        where.routeDate.gte = dateFrom;
        
        // Si solo se envía dateFrom (sin dateTo), buscar hasta el final del día (23:59:59.999) hora argentina
        if (!query.dateTo) {
          // Fin del día en Buenos Aires (23:59:59.999) convertido a UTC
          // Sumar 1 día al inicio y restar 1 milisegundo para obtener el final del día
          const dateFromEnd = DateUtil.fromObject({
            year,
            month,
            day,
            hour: 23,
            minute: 59,
            second: 59,
            millisecond: 999,
          }).toJSDate();
          where.routeDate.lte = dateFromEnd;
          
          // Log temporal para debugging
          this.logger.debug(
            `Buscando rutas desde ${dateFrom.toISOString()} hasta ${dateFromEnd.toISOString()}`,
          );
        }
      }
      if (query.dateTo) {
        // Extraer solo la fecha (YYYY-MM-DD) si viene con hora
        const dateToStr = query.dateTo.includes('T') 
          ? query.dateTo.split('T')[0]
          : query.dateTo;
        
        // Crear fin del día en Buenos Aires (23:59:59.999 GMT-3)
        const [year, month, day] = dateToStr.split('-').map(Number);
        const dateToDT = DateUtil.fromObject({
          year,
          month,
          day,
          hour: 23,
          minute: 59,
          second: 59,
          millisecond: 999,
        });
        const dateTo = dateToDT.toJSDate();
        where.routeDate.lte = dateTo;
      }
    }

    // Log temporal para debugging
    this.logger.debug(
      `Buscando rutas con filtros: ${JSON.stringify(where, null, 2)}`,
    );

    // Verificar si hay rutas en la base de datos para este manager
    const allRoutes = await this.prisma.dailyCollectionRoute.findMany({
      where: {
        managerId: where.managerId,
      },
      select: {
        id: true,
        routeDate: true,
        status: true,
        managerId: true,
      },
      orderBy: {
        routeDate: 'desc',
      },
      take: 5, // Solo las últimas 5 para no saturar el log
    });
    
    if (allRoutes.length > 0) {
      this.logger.debug(
        `Rutas encontradas en BD para este manager: ${JSON.stringify(
          allRoutes.map((r) => ({
            id: r.id,
            routeDate: r.routeDate.toISOString(),
            status: r.status,
          })),
        )}`,
      );
    } else {
      this.logger.debug('No se encontró ninguna ruta para este manager');
    }
    
    // Verificar específicamente si hay una ruta que coincida con el filtro de fecha
    if (where.routeDate) {
      const matchingRoute = await this.prisma.dailyCollectionRoute.findFirst({
        where: {
          managerId: where.managerId,
          routeDate: where.routeDate,
        },
        select: {
          id: true,
          routeDate: true,
          status: true,
        },
      });
      
      if (matchingRoute) {
        this.logger.debug(
          `Ruta que coincide con filtro de fecha: ${JSON.stringify({
            id: matchingRoute.id,
            routeDate: matchingRoute.routeDate.toISOString(),
            status: matchingRoute.status,
          })}`,
        );
      } else {
        this.logger.debug(
          `No se encontró ninguna ruta que coincida con el filtro de fecha: ${JSON.stringify(where.routeDate)}`,
        );
      }
    }

    // Log adicional: contar cuántas rutas hay con estos filtros
    const routesCount = await this.prisma.dailyCollectionRoute.count({
      where,
    });
    this.logger.debug(`Total de rutas encontradas con filtros: ${routesCount}`);

    const routes = await this.prisma.dailyCollectionRoute.findMany({
      where,
      include: {
        items: {
          include: {
            subLoan: {
              include: {
                loan: {
                  select: {
                    loanTrack: true,
                    amount: true,
                    currency: true,
                  },
                },
              },
            },
          },
          orderBy: {
            orderIndex: 'asc',
          },
        },
        expenses: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        routeDate: 'desc',
      },
    });

    // Transformar rutas a DTO (incluye búsqueda de préstamos del día)
    const routesWithLoans = await Promise.all(
      routes.map((route) => this.transformRouteToDto(route)),
    );

    return routesWithLoans;
  }

  /**
   * Actualizar el orden de los items de una ruta
   */
  async updateRouteOrder(
    routeId: string,
    userId: string,
    userRole: UserRole,
    updateDto: UpdateRouteOrderDto,
  ): Promise<CollectionRouteResponseDto> {
    // Verificar que la ruta existe y el usuario tiene acceso
    const route = await this.prisma.dailyCollectionRoute.findUnique({
      where: { id: routeId },
      include: {
        items: true,
        manager: true,
      },
    });

    if (!route) {
      throw new NotFoundException('Ruta no encontrada');
    }

    // Verificar acceso
    if (userRole === UserRole.MANAGER && route.managerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta ruta');
    } else if (userRole === UserRole.SUBADMIN) {
      // Verificar que el manager está bajo este subadmin
      const manager = await this.prisma.user.findFirst({
        where: {
          id: route.managerId,
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
      });

      if (!manager) {
        throw new ForbiddenException('No tienes acceso a esta ruta');
      }
    }

    // Verificar que la ruta está activa
    if (route.status !== 'ACTIVE') {
      throw new BadRequestException(
        'No se puede modificar el orden de una ruta cerrada',
      );
    }

    // Actualizar el orden de los items
    await this.prisma.$transaction(
      updateDto.items.map((item) =>
        this.prisma.collectionRouteItem.update({
          where: { id: item.itemId },
          data: { orderIndex: item.orderIndex },
        }),
      ),
    );

    // Obtener la ruta actualizada
    return this.getTodayActiveRoute(userId, userRole, route.managerId);
  }

  /**
   * Cerrar una ruta del día
   */
  async closeRoute(
    routeId: string,
    userId: string,
    userRole: UserRole,
    closeDto: CloseRouteDto,
  ): Promise<CollectionRouteResponseDto> {
    // Verificar que la ruta existe y el usuario tiene acceso
    const route = await this.prisma.dailyCollectionRoute.findUnique({
      where: { id: routeId },
      include: {
        items: {
          include: {
            subLoan: true,
          },
        },
        expenses: true,
        manager: true,
      },
    });

    if (!route) {
      throw new NotFoundException('Ruta no encontrada');
    }

    // Verificar acceso
    if (userRole === UserRole.MANAGER && route.managerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta ruta');
    } else if (userRole === UserRole.SUBADMIN) {
      const manager = await this.prisma.user.findFirst({
        where: {
          id: route.managerId,
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
      });

      if (!manager) {
        throw new ForbiddenException('No tienes acceso a esta ruta');
      }
    }

    // Verificar que la ruta está activa
    if (route.status === 'CLOSED') {
      throw new BadRequestException('Esta ruta ya está cerrada');
    }

    // Calcular totales actualizados
    let totalCollected = new Decimal(0);
    let totalExpenses = new Decimal(0);

    const updatedItems: any[] = [];

    // Calcular total cobrado desde los subloans (paidAmount)
    for (const item of route.items) {
      const itemCollected = item?.subLoan?.paidAmount ?? new Decimal(0);
      totalCollected = totalCollected.add(itemCollected);

      updatedItems.push({
        id: item.id,
        amountCollected: itemCollected,
      });
    }

    // Calcular total de gastos desde los expenses de la ruta
    if (route.expenses) {
      for (const expense of route.expenses) {
        totalExpenses = totalExpenses.add(expense.amount);
      }
    }

    const netAmount = totalCollected.sub(totalExpenses);

    // Calcular total "real" cobrado del día desde payments (para totalCollectedPayments)
    // route.routeDate es el startOfDay Buenos Aires guardado en UTC (03:00Z).
    const dayStart = DateUtil.startOfDay(DateUtil.fromJSDate(route.routeDate)).toJSDate();
    const dayEnd = DateUtil.endOfDay(DateUtil.fromJSDate(route.routeDate)).toJSDate();
    const paymentsSum = await this.prisma.payment.aggregate({
      where: {
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        subLoan: {
          loan: {
            managerId: route.managerId,
          },
        },
      },
      _sum: {
        amount: true,
      },
    });
    const totalCollectedPayments = paymentsSum._sum.amount ?? new Decimal(0);

    // Actualizar la ruta y sus items en una transacción
    await this.prisma.$transaction([
      ...updatedItems.map((item) =>
        this.prisma.collectionRouteItem.update({
          where: { id: item.id },
          data: {
            amountCollected: item.amountCollected,
          },
        }),
      ),
      this.prisma.dailyCollectionRoute.update({
        where: { id: routeId },
        data: {
          status: 'CLOSED',
          totalCollected,
          totalCollectedPayments,
          totalExpenses,
          netAmount,
          notes: closeDto.notes,
          closedAt: DateUtil.now().toJSDate(),
        },
      }),
    ]);

    // Obtener la ruta cerrada completa
    const closedRoute = await this.prisma.dailyCollectionRoute.findUnique({
      where: { id: routeId },
      include: {
        items: {
          include: {
            subLoan: {
              include: {
                loan: {
                  select: {
                    loanTrack: true,
                    amount: true,
                    currency: true,
                  },
                },
              },
            },
          },
          orderBy: {
            orderIndex: 'asc',
          },
        },
        expenses: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    return this.transformRouteToDto(closedRoute!);
  }

  /**
   * Obtener una ruta específica por ID
   */
  async getRouteById(
    routeId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<CollectionRouteResponseDto> {
    const route = await this.prisma.dailyCollectionRoute.findUnique({
      where: { id: routeId },
      include: {
        items: {
          include: {
            subLoan: {
              include: {
                loan: {
                  select: {
                    loanTrack: true,
                    amount: true,
                    currency: true,
                  },
                },
              },
            },
          },
          orderBy: {
            orderIndex: 'asc',
          },
        },
        expenses: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!route) {
      throw new NotFoundException('Ruta no encontrada');
    }

    // Verificar acceso
    if (userRole === UserRole.MANAGER && route.managerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta ruta');
    } else if (userRole === UserRole.SUBADMIN) {
      const manager = await this.prisma.user.findFirst({
        where: {
          id: route.managerId,
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
      });

      if (!manager) {
        throw new ForbiddenException('No tienes acceso a esta ruta');
      }
    }

    return await this.transformRouteToDto(route);
  }

  /**
   * Crear un gasto en una ruta
   */
  async createRouteExpense(
    routeId: string,
    userId: string,
    userRole: UserRole,
    createExpenseDto: CreateRouteExpenseDto,
  ): Promise<RouteExpenseResponseDto> {
    // Verificar acceso a la ruta
    const route = await this.verifyRouteAccess(routeId, userId, userRole);

    // Verificar que la ruta está activa
    if (route.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se pueden agregar gastos a rutas activas',
      );
    }

    // Crear gasto y registrar en collector wallet en una transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.routeExpense.create({
      data: {
        routeId,
        category: createExpenseDto.category as any,
        amount: new Decimal(createExpenseDto.amount),
        description: createExpenseDto.description,
      },
      });

      // Registrar el gasto en la collector wallet del manager
      await this.collectorWalletService.recordRouteExpense({
        userId: route.managerId,
        amount: Number(createExpenseDto.amount),
        description: `Gasto de ruta: ${createExpenseDto.description}`,
        routeId: route.id,
        transaction: tx,
      });

      return expense;
    });

    return {
      id: result.id,
      routeId: result.routeId,
      category: result.category,
      amount: Number(result.amount),
      description: result.description,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Actualizar un gasto
   */
  async updateRouteExpense(
    expenseId: string,
    userId: string,
    userRole: UserRole,
    updateExpenseDto: UpdateRouteExpenseDto,
  ): Promise<RouteExpenseResponseDto> {
    const expense = await this.prisma.routeExpense.findUnique({
      where: { id: expenseId },
      include: { route: true },
    });

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    // Verificar acceso a la ruta
    await this.verifyRouteAccess(expense.routeId, userId, userRole);

    // Verificar que la ruta está activa
    if (expense.route.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se pueden modificar gastos de rutas activas',
      );
    }

    const updatedExpense = await this.prisma.routeExpense.update({
      where: { id: expenseId },
      data: {
        ...(updateExpenseDto.category && { category: updateExpenseDto.category as any }),
        ...(updateExpenseDto.amount && { amount: new Decimal(updateExpenseDto.amount) }),
        ...(updateExpenseDto.description && { description: updateExpenseDto.description }),
      },
    });

    return {
      id: updatedExpense.id,
      routeId: updatedExpense.routeId,
      category: updatedExpense.category,
      amount: Number(updatedExpense.amount),
      description: updatedExpense.description,
      createdAt: updatedExpense.createdAt,
      updatedAt: updatedExpense.updatedAt,
    };
  }

  /**
   * Eliminar un gasto
   */
  async deleteRouteExpense(
    expenseId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<{ message: string }> {
    const expense = await this.prisma.routeExpense.findUnique({
      where: { id: expenseId },
      include: { route: true },
    });

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    // Verificar acceso
    await this.verifyRouteAccess(expense.routeId, userId, userRole);

    // Verificar que la ruta está activa
    if (expense.route.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se pueden eliminar gastos de rutas activas',
      );
    }

    await this.prisma.routeExpense.delete({
      where: { id: expenseId },
    });

    return { message: 'Gasto eliminado exitosamente' };
  }

  /**
   * Helper: Verificar acceso a una ruta
   */
  private async verifyRouteAccess(
    routeId: string,
    userId: string,
    userRole: UserRole,
  ) {
    const route = await this.prisma.dailyCollectionRoute.findUnique({
      where: { id: routeId },
    });

    if (!route) {
      throw new NotFoundException('Ruta no encontrada');
    }

    if (userRole === UserRole.MANAGER && route.managerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta ruta');
    } else if (userRole === UserRole.SUBADMIN) {
      const manager = await this.prisma.user.findFirst({
        where: {
          id: route.managerId,
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
      });

      if (!manager) {
        throw new ForbiddenException('No tienes acceso a esta ruta');
      }
    }

    return route;
  }

  /**
   * Helper: Buscar préstamos creados el mismo día que la ruta
   */
  private async getLoansOfDay(
    managerId: string,
    routeDate: Date,
  ): Promise<number> {
    // Obtener inicio y fin del día de la ruta en hora argentina
    const routeDateDT = DateUtil.fromJSDate(routeDate);
    const dayStart = routeDateDT.startOf('day').toJSDate();
    const dayEnd = routeDateDT.endOf('day').toJSDate();

    // Buscar préstamos creados ese día por el manager
    const loansOfDay = await this.prisma.loan.findMany({
      where: {
        managerId,
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        deletedAt: null,
      },
      select: {
        originalAmount: true,
      },
    });

    // Calcular total de préstamos del día
    return loansOfDay.reduce(
      (sum, loan) => sum + Number(loan.originalAmount),
      0,
    );
  }

  /**
   * Helper: Transformar ruta de Prisma a DTO
   */
  private async transformRouteToDto(route: any): Promise<CollectionRouteResponseDto> {
    // Buscar préstamos del día
    const totalLoaned = await this.getLoansOfDay(route.managerId, route.routeDate);
    
    // totalCollectedPayments: suma "real" cobrada ese día (payments del día).
    // totalCollected: se mantiene por compatibilidad, pero se basa en totalCollectedPayments.
    const totalCollectedPayments = Number(route.totalCollectedPayments ?? 0);

    let totalCollected = totalCollectedPayments;
    let totalExpenses = Number(route.totalExpenses);
    let netAmount = Number(route.netAmount);

    if (route.status === 'ACTIVE') {
      // Calcular total de gastos desde los expenses de la ruta
      totalExpenses = (route.expenses || []).reduce(
        (sum: number, expense: any) => sum + Number(expense.amount),
        0,
      );
    }

    // Neto siempre coherente con el total real cobrado del día:
    // neto = totalCollectedPayments - gastos - préstamos del día
    netAmount = totalCollectedPayments - totalExpenses - totalLoaned;

    return {
      id: route.id,
      managerId: route.managerId,
      routeDate: route.routeDate,
      status: route.status,
      totalCollected,
      totalCollectedPayments,
      totalExpenses,
      netAmount,
      totalLoaned,
      notes: route.notes,
      closedAt: route.closedAt,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
      manager: route.manager,
      items: route.items.map((item: any) => ({
        id: item.id,
        routeId: item.routeId,
        subLoanId: item.subLoanId,
        clientName: item.clientName,
        clientPhone: item.clientPhone,
        clientAddress: item.clientAddress,
        orderIndex: item.orderIndex,
        amountCollected: Number(item.amountCollected),
        notes: item.notes,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        subLoan: item.subLoan
          ? {
              id: item.subLoan.id,
              paymentNumber: item.subLoan.paymentNumber,
              amount: Number(item.subLoan.amount),
              totalAmount: Number(item.subLoan.totalAmount),
              paidAmount: Number(item.subLoan.paidAmount),
              status: item.subLoan.status,
              dueDate: item.subLoan.dueDate,
              loan: item.subLoan.loan,
            }
          : undefined,
      })),
      expenses: (route.expenses || []).map((expense: any) => ({
        id: expense.id,
        routeId: expense.routeId,
        category: expense.category,
        amount: Number(expense.amount),
        description: expense.description,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
      })),
    };
  }

  async getTodayExpenses(userId: string, userRole: UserRole) {
    // Obtener la fecha de hoy (inicio y fin del día)
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Construir whereClause basado en el rol del usuario
    const whereClause: any = {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      // MANAGER: solo sus gastos
      whereClause.route = {
        managerId: userId,
      };
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: gastos de sus managers
      const managedUsers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });
      const managedUserIds = managedUsers.map((u) => u.id);
      whereClause.route = {
        managerId: { in: managedUserIds },
      };
    }
    // ADMIN y SUPERADMIN ven todos los gastos

    const expenses = await this.prisma.routeExpense.findMany({
      where: whereClause,
      include: {
        route: {
          include: {
            manager: {
              select: {
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transformar los datos para devolver el formato requerido
    const transformedExpenses = expenses.map((expense) => ({
      monto: Number(expense.amount),
      categoria: expense.category,
      descripcion: expense.description,
      nombreManager: expense.route.manager.fullName,
      emailManager: expense.route.manager.email,
      fechaGasto: expense.createdAt,
    }));

    // Calcular totales
    const total = transformedExpenses.length;
    const totalAmount = transformedExpenses.reduce(
      (sum, expense) => sum + expense.monto,
      0,
    );

    // Formatear fecha para la respuesta
    const date = today.toISOString().split('T')[0]; // YYYY-MM-DD

    return {
      date,
      total,
      totalAmount,
      expenses: transformedExpenses,
    };
  }
}

