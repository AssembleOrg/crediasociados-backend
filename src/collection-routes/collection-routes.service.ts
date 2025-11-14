import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
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

@Injectable()
export class CollectionRoutesService {
  private readonly logger = new Logger(CollectionRoutesService.name);

  constructor(private prisma: PrismaService) {}

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

    return this.transformRouteToDto(route);
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

    // Filtros de fecha (comparar solo por DÍA, no por hora)
    if (query.dateFrom || query.dateTo) {
      where.routeDate = {};
      if (query.dateFrom) {
        // Parsear fecha en zona horaria Argentina y normalizar al inicio del día
        const dateFrom = DateUtil.fromPrismaDate(DateUtil.parseToDate(query.dateFrom))
          .startOf('day')
          .toJSDate();
        where.routeDate.gte = dateFrom;
        
        // Si solo se envía dateFrom (sin dateTo), buscar solo ese día específico
        if (!query.dateTo) {
          const dateFromEnd = DateUtil.fromPrismaDate(DateUtil.parseToDate(query.dateFrom))
            .startOf('day')
            .plus({ days: 1 })
            .toJSDate();
          where.routeDate.lt = dateFromEnd;
        }
      }
      if (query.dateTo) {
        // Parsear fecha en zona horaria Argentina y normalizar al inicio del día
        // Luego sumar 1 día para incluir todo el día dateTo
        const dateTo = DateUtil.fromPrismaDate(DateUtil.parseToDate(query.dateTo))
          .startOf('day')
          .plus({ days: 1 })
          .toJSDate();
        where.routeDate.lt = dateTo; // Usar 'lt' (less than) en vez de 'lte'
      }
    }

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

    return routes.map((route) => this.transformRouteToDto(route));
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

    return this.transformRouteToDto(route);
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

    const expense = await this.prisma.routeExpense.create({
      data: {
        routeId,
        category: createExpenseDto.category as any,
        amount: new Decimal(createExpenseDto.amount),
        description: createExpenseDto.description,
      },
    });

    return {
      id: expense.id,
      routeId: expense.routeId,
      category: expense.category,
      amount: Number(expense.amount),
      description: expense.description,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
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
   * Helper: Transformar ruta de Prisma a DTO
   */
  private transformRouteToDto(route: any): CollectionRouteResponseDto {
    // Si la ruta está ACTIVE, calcular totales en tiempo real
    let totalCollected = Number(route.totalCollected);
    let totalExpenses = Number(route.totalExpenses);
    let netAmount = Number(route.netAmount);

    if (route.status === 'ACTIVE') {
      // Calcular total cobrado desde paidAmount de los subloans
      totalCollected = route.items.reduce((sum: number, item: any) => {
        const paidAmount = item.subLoan?.paidAmount || 0;
        return sum + Number(paidAmount);
      }, 0);

      // Calcular total de gastos desde los expenses de la ruta
      totalExpenses = (route.expenses || []).reduce((sum: number, expense: any) => {
        return sum + Number(expense.amount);
      }, 0);

      // Calcular neto
      netAmount = totalCollected - totalExpenses;
    }

    return {
      id: route.id,
      managerId: route.managerId,
      routeDate: route.routeDate,
      status: route.status,
      totalCollected,
      totalExpenses,
      netAmount,
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

