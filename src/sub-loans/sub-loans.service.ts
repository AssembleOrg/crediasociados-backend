import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../common/enums';

@Injectable()
export class SubLoansService {
  constructor(private prisma: PrismaService) {}

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
            client: {
              managers: {
                some: {
                  userId: userId,
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
            client: {
              managers: {
                some: {
                  userId: userId,
                  deletedAt: null,
                },
              },
            },
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
          client: {
            managers: {
              some: {
                userId: userId,
                deletedAt: null,
              },
            },
          },
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
}
