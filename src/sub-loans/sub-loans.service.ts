import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubLoansService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obtiene todos los subloans que vencen hoy (cualquier estado) con paginación
   */
  async getTodayDueSubLoans(userId: string, page: number = 1, limit: number = 20) {
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
          in: pendingSubLoans.map(subLoan => subLoan.id),
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
      subLoanIds: pendingSubLoans.map(subLoan => subLoan.id),
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
}
