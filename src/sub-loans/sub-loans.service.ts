import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../common/enums';
import { DateUtil } from '../common/utils';

@Injectable()
export class SubLoansService {
  constructor(private prisma: PrismaService) {}

  /**
   * Actualiza la fecha de vencimiento de un subloan.
   * Si la nueva fecha es hoy y existe una ruta activa, agrega el subloan a la ruta.
   * Si la fecha anterior era hoy y la nueva no, elimina el item de la ruta de hoy.
   */
  async updateDueDate(subLoanId: string, userId: string, dueDate: string) {
    const subLoan = await this.prisma.subLoan.findFirst({
      where: {
        id: subLoanId,
        deletedAt: null,
        loan: {
          deletedAt: null,
          managerId: userId,
        },
      },
      include: {
        loan: {
          include: {
            client: {
              select: { fullName: true, phone: true, address: true },
            },
          },
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    const newDueDate = new Date(dueDate);
    const todayStart = DateUtil.now().startOf('day').toJSDate();
    const todayEnd = DateUtil.now().endOf('day').toJSDate();

    const isNewDateToday = newDueDate >= todayStart && newDueDate <= todayEnd;
    const wasOldDateToday =
      subLoan.dueDate >= todayStart && subLoan.dueDate <= todayEnd;

    // Actualizar la fecha
    const updated = await this.prisma.subLoan.update({
      where: { id: subLoanId },
      data: { dueDate: newDueDate },
      select: { id: true, paymentNumber: true, dueDate: true },
    });

    // Si la nueva fecha es hoy, agregar a la ruta activa de hoy (si existe y no esta ya)
    if (isNewDateToday) {
      const todayRoute = await this.prisma.dailyCollectionRoute.findFirst({
        where: {
          managerId: userId,
          routeDate: todayStart,
          status: 'ACTIVE',
        },
        include: {
          items: { select: { subLoanId: true } },
        },
      });

      if (todayRoute) {
        const alreadyInRoute = todayRoute.items.some(
          (item) => item.subLoanId === subLoanId,
        );

        if (!alreadyInRoute) {
          const maxOrder = todayRoute.items.length;
          await this.prisma.collectionRouteItem.create({
            data: {
              routeId: todayRoute.id,
              subLoanId: subLoanId,
              clientName: subLoan.loan.client.fullName,
              clientPhone: subLoan.loan.client.phone,
              clientAddress: subLoan.loan.client.address,
              orderIndex: maxOrder,
              amountCollected: new Decimal(0),
            },
          });
        }
      }
    }

    // Si la fecha anterior era hoy y la nueva no, eliminar de la ruta de hoy
    if (wasOldDateToday && !isNewDateToday) {
      const todayRoute = await this.prisma.dailyCollectionRoute.findFirst({
        where: {
          managerId: userId,
          routeDate: todayStart,
          status: 'ACTIVE',
        },
      });

      if (todayRoute) {
        await this.prisma.collectionRouteItem.deleteMany({
          where: {
            routeId: todayRoute.id,
            subLoanId: subLoanId,
          },
        });
      }
    }

    return {
      ...updated,
      addedToTodayRoute: isNewDateToday,
      removedFromTodayRoute: wasOldDateToday && !isNewDateToday,
    };
  }

  /**
   * Actualiza la fecha de pago de un subloan
   */
  async updatePaidDate(subLoanId: string, userId: string, paidDate: string | null) {
    const subLoan = await this.prisma.subLoan.findFirst({
      where: {
        id: subLoanId,
        deletedAt: null,
        loan: {
          deletedAt: null,
          managerId: userId,
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    return this.prisma.subLoan.update({
      where: { id: subLoanId },
      data: { paidDate: paidDate ? new Date(paidDate) : null },
      select: {
        id: true,
        paymentNumber: true,
        paidDate: true,
      },
    });
  }

  /**
   * Obtiene todos los subloans que vencen hoy (cualquier estado) con paginación
   */
  async getTodayDueSubLoans(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Inicio del día
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999); // Fin del día

    const skip = (page - 1) * limit;

    // Asegurar que el límite mínimo sea 20
    const actualLimit = Math.max(limit, 20);

    const [subLoans, total] = await Promise.all([
      this.prisma.subLoan.findMany({
        where: {
          deletedAt: null,
          dueDate: {
            gte: today,
            lte: endOfDay,
          },
          loan: {
            deletedAt: null,
            managerId: userId,
          },
        },
        include: {
          loan: {
            include: {
              client: {
                select: {
                  id: true,
                  fullName: true,
                  dni: true,
                  cuit: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
          payments: {
            select: {
              id: true,
              description: true,
              amount: true,
              paymentDate: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
        skip,
        take: actualLimit,
      }),
      this.prisma.subLoan.count({
        where: {
          deletedAt: null,
          dueDate: {
            gte: today,
            lte: endOfDay,
          },
          loan: {
            deletedAt: null,
            managerId: userId,
          },
        },
      }),
    ]);

    return {
      data: subLoans,
      meta: {
        page,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNextPage: page * actualLimit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Activa todos los subloans que vencen hoy (cambia status a OVERDUE si no están pagados)
   */
  async activateTodayDueSubLoans() {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Inicio del día
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999); // Fin del día

    // Obtener subloans que vencen hoy y están pendientes
    const pendingSubLoans = await this.prisma.subLoan.findMany({
      where: {
        deletedAt: null,
        status: 'PENDING',
        dueDate: {
          gte: today,
          lte: endOfDay,
        },
      },
    });

    if (pendingSubLoans.length === 0) {
      return { message: 'No hay subloans pendientes que vencen hoy', count: 0 };
    }

    // Actualizar status a OVERDUE para los subloans que vencen hoy
    const updateResult = await this.prisma.subLoan.updateMany({
      where: {
        id: {
          in: pendingSubLoans.map((subLoan) => subLoan.id),
        },
      },
      data: {
        status: 'OVERDUE',
        updatedAt: new Date(),
      },
    });

    return {
      message: `Se activaron ${updateResult.count} subloans que vencen hoy`,
      count: updateResult.count,
      subLoanIds: pendingSubLoans.map((subLoan) => subLoan.id),
    };
  }

  /**
   * Marca como OVERDUE todos los subloans cuya fecha de vencimiento ya pasó
   * (solo PENDING o PARTIAL)
   */
  async markOverdueSubLoans() {
    // Obtener inicio del día actual en GMT-3 usando DateUtil
    const todayStart = new Date();
    //add one day to the todayStart
    todayStart.setHours(0, 0, 0, 0);

    // Buscar subloans cuya fecha de vencimiento es ANTERIOR al día de hoy
    // y que aún están PENDING o PARTIAL
    const updateResult = await this.prisma.subLoan.updateMany({
      where: {
        deletedAt: null,
        status: {
          in: ['PENDING'],
        },
        dueDate: {
          lt: todayStart, // Menor que el inicio del día actual (solo compara fechas, no horas)
        },
      },
      data: {
        status: 'OVERDUE',
        updatedAt: new Date(),
      },
    });

    return {
      message: `Se marcaron ${updateResult.count} subloans como OVERDUE`,
      count: updateResult.count,
    };
  }

  /**
   * Obtiene estadísticas de subloans que vencen hoy
   */
  async getTodayDueSubLoansStats(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const stats = await this.prisma.subLoan.groupBy({
      by: ['status'],
      where: {
        deletedAt: null,
        dueDate: {
          gte: today,
          lte: endOfDay,
        },
        loan: {
          deletedAt: null,
          managerId: userId,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        amount: true,
        totalAmount: true,
      },
    });

    return stats;
  }

  /**
   * Obtiene subloans con información del cliente para reportes
   */
  async getSubLoansWithClientInfo(
    userId: string,
    userRole: UserRole,
    filters: {
      status?: string;
      dueDateFrom?: string;
      dueDateTo?: string;
    },
  ) {
    const where: any = {
      deletedAt: null,
    };

    // Filtrar por rol
    if (userRole === UserRole.MANAGER) {
      where.loan = {
        managerId: userId,
        deletedAt: null,
      };
    } else if (userRole === UserRole.SUBADMIN) {
      // Obtener managers del subadmin
      const managers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          role: UserRole.MANAGER,
          deletedAt: null,
        },
        select: { id: true },
      });

      where.loan = {
        managerId: { in: managers.map((m) => m.id) },
        deletedAt: null,
      };
    }

    // Filtro de estado
    if (filters.status) {
      where.status = filters.status;
    }

    // Filtros de fecha de vencimiento
    if (filters.dueDateFrom || filters.dueDateTo) {
      where.dueDate = {};
      if (filters.dueDateFrom) {
        const from = new Date(filters.dueDateFrom);
        from.setHours(0, 0, 0, 0);
        where.dueDate.gte = from;
      }
      if (filters.dueDateTo) {
        const to = new Date(filters.dueDateTo);
        to.setHours(23, 59, 59, 999);
        where.dueDate.lte = to;
      }
    }

    const subLoans = await this.prisma.subLoan.findMany({
      where,
      include: {
        loan: {
          select: {
            id: true,
            loanTrack: true,
            amount: true,
            currency: true,
            paymentFrequency: true,
            client: {
              select: {
                id: true,
                fullName: true,
                dni: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    return subLoans.map((subLoan) => ({
      id: subLoan.id,
      loanId: subLoan.loanId,
      amount: subLoan.amount,
      totalAmount: subLoan.totalAmount,
      paidAmount: subLoan.paidAmount,
      status: subLoan.status,
      dueDate: subLoan.dueDate,
      paymentNumber: subLoan.paymentNumber,
      createdAt: subLoan.createdAt,
      loan: {
        id: subLoan.loan.id,
        loanTrack: subLoan.loan.loanTrack,
        amount: subLoan.loan.amount,
        currency: subLoan.loan.currency,
        paymentFrequency: subLoan.loan.paymentFrequency,
      },
      client: subLoan.loan.client,
    }));
  }

  /**
   * Obtiene clientes con cuotas vencidas, agrupados por cliente.
   * Para SUBADMIN: muestra clientes de sus managers.
   * Para ADMIN/SUPERADMIN: muestra todos.
   */
  async getOverdueClients(userId: string, userRole: UserRole) {
    const where: any = {
      deletedAt: null,
      status: 'OVERDUE',
    };

    if (userRole === UserRole.SUBADMIN) {
      const managers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          role: UserRole.MANAGER,
          deletedAt: null,
        },
        select: { id: true, fullName: true },
      });

      where.loan = {
        managerId: { in: managers.map((m) => m.id) },
        deletedAt: null,
        status: 'ACTIVE',
      };
    } else if (userRole === UserRole.MANAGER) {
      where.loan = {
        managerId: userId,
        deletedAt: null,
        status: 'ACTIVE',
      };
    } else {
      where.loan = {
        deletedAt: null,
        status: 'ACTIVE',
      };
    }

    // Obtener managers para enriquecer con nombres
    const managersData = userRole === UserRole.SUBADMIN
      ? await this.prisma.user.findMany({
          where: { createdById: userId, role: UserRole.MANAGER, deletedAt: null },
          select: { id: true, fullName: true },
        })
      : userRole === UserRole.MANAGER
        ? [await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true } })]
        : await this.prisma.user.findMany({
            where: { role: UserRole.MANAGER, deletedAt: null },
            select: { id: true, fullName: true },
          });

    const managersMap = new Map(
      managersData.filter(Boolean).map((m) => [m!.id, m!.fullName]),
    );

    const overdueSubLoans = await this.prisma.subLoan.findMany({
      where,
      include: {
        loan: {
          include: {
            client: {
              select: {
                id: true,
                fullName: true,
                dni: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    // Agrupar por cliente
    const clientsMap = new Map<string, {
      client: { id: string; fullName: string; dni: string | null; phone: string | null };
      manager: { id: string; fullName: string };
      loans: Map<string, {
        id: string;
        loanTrack: string;
        amount: number;
        originalAmount: number;
        currency: string;
        paymentFrequency: string;
        totalPayments: number;
        overdueInstallments: Array<{
          id: string;
          paymentNumber: number;
          totalAmount: number;
          paidAmount: number;
          pendingAmount: number;
          dueDate: Date;
          status: string;
        }>;
      }>;
    }>();

    for (const subLoan of overdueSubLoans) {
      const clientId = subLoan.loan.client.id;
      const loanId = subLoan.loan.id;

      if (!clientsMap.has(clientId)) {
        clientsMap.set(clientId, {
          client: subLoan.loan.client,
          manager: {
            id: subLoan.loan.managerId || '',
            fullName: managersMap.get(subLoan.loan.managerId || '') || 'Sin asignar',
          },
          loans: new Map(),
        });
      }

      const clientEntry = clientsMap.get(clientId)!;

      if (!clientEntry.loans.has(loanId)) {
        clientEntry.loans.set(loanId, {
          id: subLoan.loan.id,
          loanTrack: subLoan.loan.loanTrack,
          amount: Number(subLoan.loan.amount),
          originalAmount: Number(subLoan.loan.originalAmount),
          currency: subLoan.loan.currency,
          paymentFrequency: subLoan.loan.paymentFrequency,
          totalPayments: subLoan.loan.totalPayments,
          overdueInstallments: [],
        });
      }

      const totalAmount = Number(subLoan.totalAmount);
      const paidAmount = Number(subLoan.paidAmount);

      clientEntry.loans.get(loanId)!.overdueInstallments.push({
        id: subLoan.id,
        paymentNumber: subLoan.paymentNumber,
        totalAmount,
        paidAmount,
        pendingAmount: Math.max(0, totalAmount - paidAmount),
        dueDate: subLoan.dueDate,
        status: subLoan.status,
      });
    }

    // Convertir a array
    const result = Array.from(clientsMap.values()).map((entry) => {
      const loans = Array.from(entry.loans.values());
      const totalOverdueAmount = loans.reduce(
        (sum, loan) =>
          sum +
          loan.overdueInstallments.reduce((s, inst) => s + inst.pendingAmount, 0),
        0,
      );
      const totalOverdueInstallments = loans.reduce(
        (sum, loan) => sum + loan.overdueInstallments.length,
        0,
      );

      return {
        client: entry.client,
        manager: entry.manager,
        loans,
        totalOverdueAmount,
        totalOverdueInstallments,
      };
    });

    // Ordenar por monto vencido descendente
    result.sort((a, b) => b.totalOverdueAmount - a.totalOverdueAmount);

    return {
      clients: result,
      total: result.length,
      totalOverdueAmount: result.reduce((sum, r) => sum + r.totalOverdueAmount, 0),
      totalOverdueInstallments: result.reduce((sum, r) => sum + r.totalOverdueInstallments, 0),
    };
  }

  /**
   * Endpoint dedicado para la vista de cobros.
   * Server-side: filtrado, agrupado por cliente, urgencia, paginación, y stats globales.
   */
  async getCobros(
    userId: string,
    filters: {
      urgency?: 'overdue' | 'today' | 'soon' | 'future' | 'all';
      paymentStatus?: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page || 1;
    const limit = Math.max(filters.limit || 20, 20);

    // Date boundaries for urgency calculation (Argentina timezone)
    const todayStart = DateUtil.now().startOf('day').toJSDate();
    const todayEnd = DateUtil.now().endOf('day').toJSDate();
    const soonEnd = DateUtil.now().plus({ days: 2 }).endOf('day').toJSDate();

    // Base where clause: subloans from active loans of this manager
    const baseWhere: any = {
      deletedAt: null,
      loan: {
        deletedAt: null,
        managerId: userId,
        status: { in: ['ACTIVE', 'APPROVED'] },
      },
    };

    // === QUERY 1: Global stats (unfiltered, counts only) ===
    const allSubLoans = await this.prisma.subLoan.findMany({
      where: baseWhere,
      select: { status: true, dueDate: true },
    });

    const globalStats = { overdue: 0, today: 0, soon: 0, future: 0, paid: 0, total: 0 };
    for (const sl of allSubLoans) {
      globalStats.total++;
      const isPaid = sl.status === 'PAID';
      if (isPaid) {
        globalStats.paid++;
        continue;
      }
      const due = sl.dueDate;
      if (due < todayStart) globalStats.overdue++;
      else if (due <= todayEnd) globalStats.today++;
      else if (due <= soonEnd) globalStats.soon++;
      else globalStats.future++;
    }

    // === QUERY 2: Filtered subloans with data ===
    const filteredWhere: any = { ...baseWhere };

    // Urgency filter via dueDate ranges
    if (filters.urgency && filters.urgency !== 'all') {
      // Exclude paid from urgency filters
      filteredWhere.status = { not: 'PAID' };
      switch (filters.urgency) {
        case 'overdue':
          filteredWhere.dueDate = { lt: todayStart };
          break;
        case 'today':
          filteredWhere.dueDate = { gte: todayStart, lte: todayEnd };
          break;
        case 'soon':
          filteredWhere.dueDate = { gt: todayEnd, lte: soonEnd };
          break;
        case 'future':
          filteredWhere.dueDate = { gt: soonEnd };
          break;
      }
    }

    // Payment status filter
    if (filters.paymentStatus) {
      filteredWhere.status = filters.paymentStatus;
    }

    // Client filter
    if (filters.clientId) {
      filteredWhere.loan = { ...filteredWhere.loan, clientId: filters.clientId };
    }

    const subLoans = await this.prisma.subLoan.findMany({
      where: filteredWhere,
      include: {
        loan: {
          select: {
            id: true,
            loanTrack: true,
            amount: true,
            currency: true,
            paymentFrequency: true,
            clientId: true,
            client: {
              select: {
                id: true,
                fullName: true,
                dni: true,
                phone: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Group by client
    const clientsMap = new Map<
      string,
      {
        client: { id: string; fullName: string; dni: string | null; phone: string | null };
        subLoans: any[];
        stats: { overdue: number; today: number; soon: number; paid: number; total: number; totalAmount: number; paidAmount: number };
        urgencyLevel: 'overdue' | 'today' | 'soon' | 'future';
      }
    >();

    for (const sl of subLoans) {
      const clientId = sl.loan.client.id;

      if (!clientsMap.has(clientId)) {
        clientsMap.set(clientId, {
          client: sl.loan.client,
          subLoans: [],
          stats: { overdue: 0, today: 0, soon: 0, paid: 0, total: 0, totalAmount: 0, paidAmount: 0 },
          urgencyLevel: 'future',
        });
      }

      const entry = clientsMap.get(clientId)!;
      const isPaid = sl.status === 'PAID';
      const due = sl.dueDate;

      // Calculate urgency for this subloan
      let slUrgency: 'overdue' | 'today' | 'soon' | 'future' = 'future';
      if (!isPaid) {
        if (due < todayStart) slUrgency = 'overdue';
        else if (due <= todayEnd) slUrgency = 'today';
        else if (due <= soonEnd) slUrgency = 'soon';
      }

      // Update client urgency (worst wins)
      const urgencyPriority = { overdue: 0, today: 1, soon: 2, future: 3 };
      if (urgencyPriority[slUrgency] < urgencyPriority[entry.urgencyLevel]) {
        entry.urgencyLevel = slUrgency;
      }

      // Stats
      entry.stats.total++;
      entry.stats.totalAmount += Number(sl.totalAmount);
      entry.stats.paidAmount += Number(sl.paidAmount);
      if (isPaid) entry.stats.paid++;
      else if (due < todayStart) entry.stats.overdue++;
      else if (due <= todayEnd) entry.stats.today++;
      else if (due <= soonEnd) entry.stats.soon++;

      entry.subLoans.push({
        id: sl.id,
        loanId: sl.loanId,
        paymentNumber: sl.paymentNumber,
        amount: Number(sl.amount),
        totalAmount: Number(sl.totalAmount),
        paidAmount: Number(sl.paidAmount),
        status: sl.status,
        dueDate: sl.dueDate,
        paidDate: sl.paidDate,
        loanTrack: sl.loan.loanTrack,
        payments: sl.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentDate: p.paymentDate,
          description: p.description,
          createdAt: p.createdAt,
        })),
      });
    }

    // Convert to array and sort by urgency then name
    const allClients = Array.from(clientsMap.values()).sort((a, b) => {
      const urgencyOrder = { overdue: 0, today: 1, soon: 2, future: 3 };
      if (a.urgencyLevel !== b.urgencyLevel) {
        return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
      }
      return a.client.fullName.localeCompare(b.client.fullName);
    });

    // Paginate clients (not subloans)
    const totalClients = allClients.length;
    const paginatedClients = allClients.slice((page - 1) * limit, page * limit);

    return {
      clients: paginatedClients,
      globalStats,
      meta: {
        page,
        limit,
        total: totalClients,
        totalPages: Math.ceil(totalClients / limit),
        hasNextPage: page * limit < totalClients,
      },
    };
  }
}
