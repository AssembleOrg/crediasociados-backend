import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClosureDto } from './dto';
import { Prisma, UserRole } from '@prisma/client';
import { DateUtil } from '../common/utils';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';

@Injectable()
export class DailyClosureService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crear un cierre diario
   */
  async createClosure(
    userId: string,
    userRole: UserRole,
    createClosureDto: CreateClosureDto,
  ): Promise<any> {
    // Solo MANAGER puede crear cierres
    if (userRole !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Solo los MANAGER pueden crear cierres diarios',
      );
    }

    const { closureDate, totalCollected, expenses, notes } = createClosureDto;

    // Parsear fecha
    const parsedDate = DateUtil.startOfDay(
      DateUtil.fromISO(closureDate),
    ).toJSDate();

    // Verificar que no exista cierre para esa fecha
    const existingClosure = await this.prisma.dailyClosure.findUnique({
      where: {
        userId_closureDate: {
          userId,
          closureDate: parsedDate,
        },
      },
    });

    if (existingClosure) {
      throw new BadRequestException(
        `Ya existe un cierre para la fecha ${closureDate}`,
      );
    }

    // Calcular total de gastos
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const netAmount = totalCollected - totalExpenses;

    // Crear cierre con gastos en transacción
    const closure = await this.prisma.$transaction(async (tx) => {
      const newClosure = await tx.dailyClosure.create({
        data: {
          userId,
          closureDate: parsedDate,
          totalCollected: new Prisma.Decimal(totalCollected),
          totalExpenses: new Prisma.Decimal(totalExpenses),
          netAmount: new Prisma.Decimal(netAmount),
          notes,
        },
      });

      // Crear gastos
      if (expenses.length > 0) {
        await tx.expense.createMany({
          data: expenses.map((exp) => ({
            dailyClosureId: newClosure.id,
            category: exp.category,
            amount: new Prisma.Decimal(exp.amount),
            description: exp.description,
          })),
        });
      }

      // Obtener cierre completo
      return tx.dailyClosure.findUnique({
        where: { id: newClosure.id },
        include: {
          expenses: true,
        },
      });
    });

    if (!closure) {
      throw new BadRequestException('Error al crear el cierre diario');
    }

    return {
      ...closure,
      totalCollected: Number(closure.totalCollected),
      totalExpenses: Number(closure.totalExpenses),
      netAmount: Number(closure.netAmount),
      expenses: closure.expenses.map((e) => ({
        ...e,
        amount: Number(e.amount),
      })),
    };
  }

  /**
   * Obtener cierres del usuario autenticado
   */
  async getMyClosure(
    userId: string,
    paginationDto: PaginationDto,
    filters?: {
      startDate?: string;
      endDate?: string;
    },
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    // Construir filtros
    const whereClause: any = {
      userId,
    };

    if (filters?.startDate || filters?.endDate) {
      whereClause.closureDate = {};
      if (filters.startDate) {
        whereClause.closureDate.gte = DateUtil.startOfDay(
          DateUtil.fromISO(filters.startDate),
        ).toJSDate();
      }
      if (filters.endDate) {
        whereClause.closureDate.lte = DateUtil.endOfDay(
          DateUtil.fromISO(filters.endDate),
        ).toJSDate();
      }
    }

    const [closures, total] = await Promise.all([
      this.prisma.dailyClosure.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { closureDate: 'desc' },
        include: {
          expenses: true,
        },
      }),
      this.prisma.dailyClosure.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: closures.map((c) => ({
        ...c,
        totalCollected: Number(c.totalCollected),
        totalExpenses: Number(c.totalExpenses),
        netAmount: Number(c.netAmount),
        expenses: c.expenses.map((e) => ({
          ...e,
          amount: Number(e.amount),
        })),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Obtener cierre por ID
   */
  async getClosureById(
    closureId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<any> {
    const closure = await this.prisma.dailyClosure.findUnique({
      where: { id: closureId },
      include: {
        expenses: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!closure) {
      throw new NotFoundException('Cierre no encontrado');
    }

    // Validar acceso
    if (userRole === UserRole.MANAGER && closure.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a este cierre');
    }

    // Si es SUBADMIN, validar que el manager sea suyo
    if (userRole === UserRole.SUBADMIN) {
      const manager = await this.prisma.user.findUnique({
        where: { id: closure.userId },
        select: { createdById: true },
      });

      if (manager?.createdById !== userId) {
        throw new ForbiddenException('No tienes acceso a este cierre');
      }
    }

    return {
      ...closure,
      totalCollected: Number(closure.totalCollected),
      totalExpenses: Number(closure.totalExpenses),
      netAmount: Number(closure.netAmount),
      expenses: closure.expenses.map((e) => ({
        ...e,
        amount: Number(e.amount),
      })),
    };
  }

  /**
   * Obtener cierre por fecha
   */
  async getClosureByDate(
    date: string,
    userId: string,
    userRole: UserRole,
  ): Promise<any> {
    const parsedDate = DateUtil.startOfDay(DateUtil.fromISO(date)).toJSDate();

    let closure;

    if (userRole === UserRole.MANAGER) {
      closure = await this.prisma.dailyClosure.findUnique({
        where: {
          userId_closureDate: {
            userId,
            closureDate: parsedDate,
          },
        },
        include: {
          expenses: true,
        },
      });
    } else {
      // Para SUBADMIN+, buscar cualquier cierre en esa fecha
      closure = await this.prisma.dailyClosure.findFirst({
        where: {
          closureDate: parsedDate,
        },
        include: {
          expenses: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });
    }

    if (!closure) {
      throw new NotFoundException(`No hay cierre para la fecha ${date}`);
    }

    // Obtener SubLoans que vencían ese día
    const subLoans = await this.getSubLoansByDate(date, userId, userRole);

    return {
      closure: {
        ...closure,
        totalCollected: Number(closure.totalCollected),
        totalExpenses: Number(closure.totalExpenses),
        netAmount: Number(closure.netAmount),
        expenses: closure.expenses.map((e) => ({
          ...e,
          amount: Number(e.amount),
        })),
      },
      subLoans,
    };
  }

  /**
   * Obtener SubLoans que vencen en una fecha específica
   */
  async getSubLoansByDate(
    date: string,
    userId: string,
    userRole: UserRole,
  ): Promise<any[]> {
    const startOfDay = DateUtil.startOfDay(DateUtil.fromISO(date)).toJSDate();
    const endOfDay = DateUtil.endOfDay(DateUtil.fromISO(date)).toJSDate();

    // Construir filtro según rol
    const whereClause: any = {
      dueDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
      deletedAt: null,
    };

    if (userRole === UserRole.MANAGER) {
      whereClause.loan = {
        client: {
          managers: {
            some: {
              userId,
              deletedAt: null,
            },
          },
        },
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

      const managerIds = managers.map((m) => m.id);

      whereClause.loan = {
        managerId: { in: managerIds },
        deletedAt: null,
      };
    }

    const subLoans = await this.prisma.subLoan.findMany({
      where: whereClause,
      include: {
        loan: {
          select: {
            id: true,
            loanTrack: true,
            amount: true,
            currency: true,
            client: {
              select: {
                id: true,
                fullName: true,
                dni: true,
                cuit: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return subLoans.map((sl) => ({
      id: sl.id,
      loanTrack: sl.loan.loanTrack,
      paymentNumber: sl.paymentNumber,
      amount: Number(sl.amount),
      totalAmount: Number(sl.totalAmount),
      paidAmount: Number(sl.paidAmount),
      status: sl.status,
      dueDate: sl.dueDate,
      paidDate: sl.paidDate,
      daysOverdue: sl.daysOverdue,
      client: sl.loan.client,
      loan: {
        id: sl.loan.id,
        loanTrack: sl.loan.loanTrack,
        amount: Number(sl.loan.amount),
        currency: sl.loan.currency,
      },
    }));
  }
}
