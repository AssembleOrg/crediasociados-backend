import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RenewLoanDto } from './dto/renew-loan.dto';
import { LoanFiltersDto, LoanChartDataDto } from '../common/dto';
import { DateUtil, TrackingCodeUtil } from '../common/utils';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { LoanPdfService } from './loan-pdf.service';
import { Prisma, SubLoanStatus, UserRole } from '@prisma/client';
import { LoanStatus, WalletTransactionType } from 'src/common/enums';
import { CollectorWalletTransactionType } from '../common/enums';
import { CollectorWalletService } from '../collector-wallet/collector-wallet.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private subLoanGenerator: SubLoanGeneratorService,
    private collectorWalletService: CollectorWalletService,
    private walletService: WalletService,
    private loanPdfService: LoanPdfService,
  ) {}

  async createLoan(createLoanDto: CreateLoanDto, userId: string) {
    // 1. Verificar si el cliente existe y es gestionado por el usuario
    const clientManager = await this.prisma.clientManager.findFirst({
      where: {
        clientId: createLoanDto.clientId,
        userId: userId,
        deletedAt: null,
      },
      include: {
        client: {
          select: {
            id: true,
            verified: true,
            fullName: true,
          },
        },
      },
    });

    if (!clientManager) {
      throw new BadRequestException(
        'Cliente no encontrado o no gestionado por el usuario',
      );
    }

    // 2. Verificar que el cliente esté verificado
    if (!clientManager.client.verified) {
      throw new BadRequestException(
        `No se puede crear un préstamo para el cliente "${clientManager.client.fullName}" porque no está verificado`,
      );
    }

    // 3. Obtener la collector wallet del manager (se permite saldo negativo)
    const collectorWallet = await this.collectorWalletService.getOrCreateWallet(userId);

    // Se removió la validación de saldo suficiente - el sistema permite saldo negativo

    // 4. Validar que la moneda del préstamo coincida con la de la collector wallet
    if (collectorWallet.currency !== createLoanDto.currency) {
      throw new BadRequestException(
        `La wallet de cobros usa ${collectorWallet.currency}, no se puede prestar en ${createLoanDto.currency}`,
      );
    }

    // 5. Generar o usar el código de tracking
    let loanTrack: string;
    let prefix: string;
    let year: number;
    let sequence: number;

    if (!createLoanDto.loanTrack) {
      // Generar código automáticamente usando secuencia atómica
      const trackingData =
        await TrackingCodeUtil.generateSequentialTrackingCode(
          this.prisma,
          'CREDITO',
        );
      loanTrack = trackingData.trackingCode;
      prefix = trackingData.prefix;
      year = trackingData.year;
      sequence = trackingData.sequence;
    } else {
      // Usar código personalizado
      loanTrack = createLoanDto.loanTrack;

      // Verificar que el código personalizado sea único
      const existingLoan = await this.prisma.loan.findUnique({
        where: { loanTrack: loanTrack },
      });

      if (existingLoan) {
        throw new BadRequestException(
          'El código de tracking ya existe en el sistema',
        );
      }

      // Para códigos personalizados, extraer información si es posible
      const parts = loanTrack.split('-');
      if (parts.length >= 3) {
        prefix = parts[0];
        year = parseInt(parts[1]) || DateUtil.now().year;
        sequence = parseInt(parts[2]) || 0;
      } else {
        prefix = 'CUSTOM';
        year = DateUtil.now().year;
        sequence = 0;
      }
    }

    // 6. Calcular el monto total con intereses
    const originalAmount = Number(createLoanDto.amount);
    const totalAmount = originalAmount * (1 + Number(createLoanDto.baseInterestRate));

    // 7. Usar transacción para crear el loan, subloans y debitar de cartera
    const result = await this.prisma.$transaction(async (prisma) => {
      // Crear el préstamo
      const loan = await prisma.loan.create({
        data: {
          clientId: createLoanDto.clientId,
          managerId: userId, // NUEVO: Agregar manager ID
          amount: totalAmount, // Monto total con intereses
          originalAmount: originalAmount, // Monto original sin intereses
          currency: createLoanDto.currency || 'ARS',
          paymentFrequency: createLoanDto.paymentFrequency,
          paymentDay: createLoanDto.paymentDay,
          status: LoanStatus.ACTIVE,
          totalPayments: createLoanDto.totalPayments,
          firstDueDate: createLoanDto.firstDueDate
            ? DateUtil.parseToDate(createLoanDto.firstDueDate)
            : null,
          loanTrack: loanTrack,
          prefix: prefix,
          year: year,
          sequence: sequence,
          description: createLoanDto.description,
          notes: createLoanDto.notes,
          baseInterestRate: createLoanDto.baseInterestRate,
          penaltyInterestRate: createLoanDto.penaltyInterestRate,
        },
        include: {
          client: true,
        },
      });

      // Generar SubLoans automáticamente
      await this.subLoanGenerator.generateSubLoans(
        loan.id,
        createLoanDto,
        createLoanDto.firstDueDate
          ? DateUtil.parseToDate(createLoanDto.firstDueDate)
          : undefined,
        prisma,
      );

      // Debitar de la collector wallet del manager (permite saldo negativo)
      await this.collectorWalletService.recordLoanDisbursement({
        userId,
        amount: Number(createLoanDto.amount),
        description: `Préstamo ${loanTrack} - ${createLoanDto.description || 'Desembolso'}`,
        loanId: loan.id,
        transaction: prisma,
      });

      // Obtener el loan con los subloans generados
      const loanWithSubLoans = await prisma.loan.findUnique({
        where: { id: loan.id },
        include: {
          client: true,
          subLoans: {
            orderBy: { paymentNumber: 'asc' },
          },
        },
      });

      return loanWithSubLoans;
    });

    return result;
  }

  async getLoanByTracking(dni: string, loanTrack: string) {
    // Find the loan by tracking code and verify DNI matches
    const loan = await this.prisma.loan.findFirst({
      where: {
        loanTrack: loanTrack,
        client: {
          dni: dni,
          deletedAt: null,
        },
        deletedAt: null,
      },
      select: {
        id: true,
        loanTrack: true,
        amount: true,
        originalAmount: true,
        status: true,
        currency: true,
        paymentFrequency: true,
        totalPayments: true,
        createdAt: true,
        // Only expose client name - no phone, email, address, cuit
        client: {
          select: {
            fullName: true,
            dni: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
          select: {
            paymentNumber: true,
            totalAmount: true,
            status: true,
            dueDate: true,
            paidAmount: true,
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado o DNI no coincide');
    }

    return loan;
  }

  async getAllActiveLoans(userId: string) {
    // Only return non-completed loans by default
    const loans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        managerId: userId,
        status: { not: 'COMPLETED' },
      },
      select: {
        id: true,
        clientId: true,
        amount: true,
        status: true,
        requestDate: true,
        approvedDate: true,
        completedDate: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        baseInterestRate: true,
        currency: true,
        firstDueDate: true,
        notes: true,
        paymentDay: true,
        paymentFrequency: true,
        penaltyInterestRate: true,
        totalPayments: true,
        loanTrack: true,
        prefix: true,
        year: true,
        sequence: true,
        originalAmount: true,
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          select: {
            id: true,
            loanId: true,
            paymentNumber: true,
            amount: true,
            totalAmount: true,
            status: true,
            dueDate: true,
            paidDate: true,
            paidAmount: true,
            daysOverdue: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            payments: {
              select: {
                id: true,
                amount: true,
                currency: true,
                paymentDate: true,
                description: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
      orderBy: [
        // ACTIVE/APPROVED first, COMPLETED/DEFAULTED last
        { status: 'asc' },
        // Within same status, newest first
        { createdAt: 'desc' },
      ],
    });

    // Re-sort with explicit priority since Prisma sorts status alphabetically
    const statusPriority: Record<string, number> = {
      ACTIVE: 0,
      APPROVED: 1,
      PENDING: 2,
      DEFAULTED: 3,
      COMPLETED: 4,
    };
    loans.sort((a: any, b: any) => {
      const pa = statusPriority[a.status] ?? 2;
      const pb = statusPriority[b.status] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return loans;
  }

  /**
   * Lightweight dashboard stats: loans per week + subloan status distribution.
   * 2 small queries instead of loading 700+ loans with all subloans.
   */
  async getDashboardStats(userId: string) {
    // Query 1: Loans created per week (last 8 weeks)
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

    const recentLoans = await this.prisma.loan.findMany({
      where: {
        managerId: userId,
        deletedAt: null,
        createdAt: { gte: eightWeeksAgo },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const loansByWeek: Record<string, number> = {};
    for (const loan of recentLoans) {
      const d = new Date(loan.createdAt);
      d.setDate(d.getDate() - d.getDay() + 1);
      const weekKey = d.toISOString().split('T')[0];
      loansByWeek[weekKey] = (loansByWeek[weekKey] || 0) + 1;
    }
    const loansEvolution = Object.entries(loansByWeek)
      .map(([date, count]) => ({ date, loans: count }))
      .slice(-8);

    // Query 2: Subloan status distribution (count only)
    const statusCounts = await this.prisma.subLoan.groupBy({
      by: ['status'],
      where: {
        deletedAt: null,
        loan: { managerId: userId, deletedAt: null },
      },
      _count: true,
    });

    const paymentsDistribution = statusCounts.map((s) => ({
      status: s.status,
      count: s._count,
    }));

    return {
      loansEvolution,
      paymentsDistribution,
    };
  }

  /**
   * One-time fix: mark all ACTIVE loans with all PAID subloans as COMPLETED.
   */
  async fixCompletePaidLoans() {
    const activeLoans = await this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        loanTrack: true,
        subLoans: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
    });

    const toComplete = activeLoans.filter(
      (loan) =>
        loan.subLoans.length > 0 &&
        loan.subLoans.every((sl) => sl.status === 'PAID'),
    );

    for (const loan of toComplete) {
      await this.prisma.loan.update({
        where: { id: loan.id },
        data: {
          status: 'COMPLETED',
          completedDate: new Date(),
        },
      });
    }

    return {
      message: `${toComplete.length} prestamos marcados como COMPLETED`,
      total: toComplete.length,
      loans: toComplete.map((l) => l.loanTrack),
    };
  }

  async getAllLoans(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Get loans based on user role and hierarchy
    const loans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        managerId: userId,
      },
      select: {
        id: true,
        clientId: true,
        amount: true,
        status: true,
        requestDate: true,
        approvedDate: true,
        completedDate: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        baseInterestRate: true,
        currency: true,
        firstDueDate: true,
        notes: true,
        paymentDay: true,
        paymentFrequency: true,
        penaltyInterestRate: true,
        totalPayments: true,
        loanTrack: true,
        prefix: true,
        year: true,
        sequence: true,
        originalAmount: true,
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          select: {
            id: true,
            loanId: true,
            paymentNumber: true,
            amount: true,
            totalAmount: true,
            status: true,
            dueDate: true,
            paidDate: true,
            paidAmount: true,
            daysOverdue: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            payments: {
              select: {
                id: true,
                amount: true,
                currency: true,
                paymentDate: true,
                description: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.prisma.loan.count({
      where: {
        deletedAt: null,
        managerId: userId,
      },
    });

    return {
      data: loans,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getLoanById(loanId: string, userId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: {
        id: loanId,
        deletedAt: null,
        managerId: userId,
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            email: true,
            address: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
        },
        transactions: {
          where: { deletedAt: null },
          orderBy: { transactionDate: 'desc' },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    return loan;
  }

  async updateDescription(loanId: string, userId: string, description: string) {
    // Verificar que el préstamo existe y pertenece al usuario
    const loan = await this.prisma.loan.findFirst({
      where: {
        id: loanId,
        deletedAt: null,
        managerId: userId,
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    return this.prisma.loan.update({
      where: { id: loanId },
      data: { description },
      select: {
        id: true,
        description: true,
      },
    });
  }

  async updateFirstDueDate(loanId: string, userId: string, firstDueDate: string) {
    const loan = await this.prisma.loan.findFirst({
      where: {
        id: loanId,
        deletedAt: null,
        managerId: userId,
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    return this.prisma.loan.update({
      where: { id: loanId },
      data: { firstDueDate: new Date(firstDueDate) },
      select: {
        id: true,
        firstDueDate: true,
      },
    });
  }

  async getAllLoansWithFilters(
    userId: string,
    userRole: UserRole,
    page: number = 1,
    limit: number = 10,
    filters: LoanFiltersDto,
  ) {
    const skip = (page - 1) * limit;

    // Construir whereClause basado en el rol del usuario
    const whereClause: any = {
      deletedAt: null,
    };

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      // MANAGER: solo sus préstamos
      whereClause.managerId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: préstamos de sus managers
      const managedUserIds = await this.getManagedUserIds(userId);
      whereClause.managerId = { in: managedUserIds };
    }
    // ADMIN y SUPERADMIN ven todos los préstamos (no aplican filtro base)

    // Aplicar filtros adicionales
    if (filters.managerId) {
      whereClause.managerId = filters.managerId;
    }

    if (filters.clientId) {
      whereClause.clientId = filters.clientId;
    }

    if (filters.loanTrack) {
      whereClause.loanTrack = {
        contains: filters.loanTrack,
        mode: 'insensitive',
      };
    }

    // Filtro por estado (soporta loanStatus para mapeo especial)
    if (filters.loanStatus) {
      if (filters.loanStatus === 'ACTIVE') {
        // ACTIVE incluye ACTIVE y APPROVED
        whereClause.status = { in: ['ACTIVE', 'APPROVED'] };
      } else if (filters.loanStatus === 'COMPLETED') {
        whereClause.status = 'COMPLETED';
      }
      // 'ALL' no aplica filtro
    } else if (filters.status) {
      // Mantener compatibilidad con el filtro status original
      whereClause.status = filters.status;
    }

    if (filters.currency) {
      whereClause.currency = filters.currency;
    }

    if (filters.paymentFrequency) {
      whereClause.paymentFrequency = filters.paymentFrequency;
    }

    if (filters.minAmount || filters.maxAmount) {
      whereClause.amount = {};
      if (filters.minAmount) {
        whereClause.amount.gte = filters.minAmount;
      }
      if (filters.maxAmount) {
        whereClause.amount.lte = filters.maxAmount;
      }
    }

    if (filters.createdFrom || filters.createdTo) {
      whereClause.createdAt = {};
      if (filters.createdFrom) {
        whereClause.createdAt.gte = DateUtil.parseToDate(filters.createdFrom);
      }
      if (filters.createdTo) {
        whereClause.createdAt.lte = DateUtil.parseToDate(filters.createdTo);
      }
    }

    if (filters.dueDateFrom || filters.dueDateTo) {
      whereClause.subLoans = {
        some: {
          deletedAt: null,
          ...(filters.dueDateFrom || filters.dueDateTo
            ? {
                dueDate: {
                  ...(filters.dueDateFrom
                    ? { gte: DateUtil.parseToDate(filters.dueDateFrom) }
                    : {}),
                  ...(filters.dueDateTo
                    ? { lte: DateUtil.parseToDate(filters.dueDateTo) }
                    : {}),
                },
              }
            : {}),
        },
      };
    }

    // Búsqueda parcial por nombre de cliente
    if (filters.clientName && filters.clientName.length >= 2) {
      whereClause.client = {
        ...whereClause.client,
        fullName: {
          contains: filters.clientName,
          mode: 'insensitive',
        },
        deletedAt: null,
      };
    }

    const [loans, total] = await Promise.all([
      this.prisma.loan.findMany({
        where: whereClause,
        include: {
          client: {
            select: {
              id: true,
              fullName: true,
              dni: true,
              cuit: true,
            },
          },
          subLoans: {
            where: { deletedAt: null },
            select: {
              id: true,
              paymentNumber: true,
              status: true,
              amount: true,
              totalAmount: true,
              dueDate: true,
              paidAmount: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loan.count({ where: whereClause }),
    ]);

    // Agregar clientName a cada loan para facilitar el acceso en el frontend
    const loansWithClientName = loans.map((loan) => ({
      ...loan,
      clientName: loan.client?.fullName || null,
    }));

    return {
      data: loansWithClientName,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getLoansChart(
    userId: string,
    userRole: UserRole,
    filters: LoanFiltersDto,
  ): Promise<LoanChartDataDto[]> {
    // Construir whereClause basado en el rol del usuario (mismo que arriba pero sin paginación)
    const whereClause: any = {
      deletedAt: null,
    };

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      whereClause.managerId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      const managedUserIds = await this.getManagedUserIds(userId);
      whereClause.managerId = { in: managedUserIds };
    }

    // Aplicar filtros adicionales
    if (filters.managerId) {
      whereClause.managerId = filters.managerId;
    }

    if (filters.clientId) {
      whereClause.clientId = filters.clientId;
    }

    if (filters.loanTrack) {
      whereClause.loanTrack = {
        contains: filters.loanTrack,
        mode: 'insensitive',
      };
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.currency) {
      whereClause.currency = filters.currency;
    }

    if (filters.paymentFrequency) {
      whereClause.paymentFrequency = filters.paymentFrequency;
    }

    if (filters.minAmount || filters.maxAmount) {
      whereClause.amount = {};
      if (filters.minAmount) {
        whereClause.amount.gte = filters.minAmount;
      }
      if (filters.maxAmount) {
        whereClause.amount.lte = filters.maxAmount;
      }
    }

    if (filters.createdFrom || filters.createdTo) {
      whereClause.createdAt = {};
      if (filters.createdFrom) {
        whereClause.createdAt.gte = DateUtil.parseToDate(filters.createdFrom);
      }
      if (filters.createdTo) {
        whereClause.createdAt.lte = DateUtil.parseToDate(filters.createdTo);
      }
    }

    if (filters.dueDateFrom || filters.dueDateTo) {
      whereClause.subLoans = {
        some: {
          deletedAt: null,
          ...(filters.dueDateFrom || filters.dueDateTo
            ? {
                dueDate: {
                  ...(filters.dueDateFrom
                    ? { gte: DateUtil.parseToDate(filters.dueDateFrom) }
                    : {}),
                  ...(filters.dueDateTo
                    ? { lte: DateUtil.parseToDate(filters.dueDateTo) }
                    : {}),
                },
              }
            : {}),
        },
      };
    }

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      select: {
        id: true,
        loanTrack: true,
        amount: true,
        originalAmount: true,
        status: true,
        currency: true,
        paymentFrequency: true,
        totalPayments: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          select: {
            status: true,
            amount: true,
            paidAmount: true,
            dueDate: true,
          },
          orderBy: { paymentNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return loans.map((loan) => {
      const completedPayments = loan.subLoans.filter(
        (sub) => sub.status === 'PAID',
      ).length;
      const pendingPayments = loan.totalPayments - completedPayments;
      const paidAmount = loan.subLoans.reduce(
        (sum, sub) => sum + Number(sub.paidAmount || 0),
        0,
      );
      const remainingAmount = Number(loan.amount) - paidAmount;
      const nextDueDate = loan.subLoans
        .filter((sub) => sub.status !== 'PAID')
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]?.dueDate;

      return {
        id: loan.id,
        loanTrack: loan.loanTrack,
        amount: Number(loan.amount),
        originalAmount: Number(loan.originalAmount),
        status: loan.status,
        currency: loan.currency,
        paymentFrequency: loan.paymentFrequency,
        totalPayments: loan.totalPayments,
        completedPayments,
        pendingPayments,
        paidAmount,
        remainingAmount,
        createdAt: loan.createdAt,
        nextDueDate,
        client: {
          ...loan.client,
          dni: loan.client.dni ?? undefined,
        },
      };
    });
  }

  private async getManagedUserIds(userId: string): Promise<string[]> {
    const managedUsers = await this.prisma.user.findMany({
      where: {
        createdById: userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    return managedUsers.map((mu) => mu.id);
  }

  async permanentlyDeleteLoan(loanId: string, userId: string): Promise<any> {
    // Obtener el préstamo con todos sus detalles
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        client: {
          include: {
            managers: {
              where: { deletedAt: null },
            },
          },
        },
        subLoans: {
          include: {
            payments: true,
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    // Verificar que el usuario tenga permisos
    if (loan.managerId !== userId) {
      throw new ForbiddenException(
        'No tienes permisos para eliminar este préstamo',
      );
    }

    // Verificar que ningún subloan haya sido pagado
    const hasAnyPaidSubLoan = loan.subLoans.some(
      (subloan) =>
        subloan.status === 'PAID' ||
        subloan.status === 'PARTIAL' ||
        (subloan.payments && subloan.payments.length > 0),
    );

    if (hasAnyPaidSubLoan) {
      throw new BadRequestException(
        'No se puede eliminar el préstamo porque tiene cuotas que ya fueron pagadas. Solo se pueden eliminar préstamos sin pagos registrados.',
      );
    }

    // Calcular cuánto dinero devolver a la wallet
    // Total del préstamo original (sin intereses) - pagos ya recibidos (debería ser 0 en este caso)
    const totalPrestamo = Number(loan.originalAmount); // Monto prestado sin intereses
    const totalPagado = loan.subLoans.reduce((sum, subloan) => {
      const pagosSubloan = subloan.payments.reduce(
        (sumPayments, payment) => sumPayments + Number(payment.amount),
        0,
      );
      return sum + pagosSubloan;
    }, 0);

    const montoADevolver = totalPrestamo - totalPagado;

    // Obtener la wallet del manager
    const managerWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!managerWallet) {
      throw new NotFoundException('Wallet del manager no encontrada');
    }

    // Eliminar el préstamo y devolver dinero en una transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Eliminar payments
      await tx.payment.deleteMany({
        where: {
          subLoan: {
            loanId: loanId,
          },
        },
      });

      // 2. Eliminar subloans
      await tx.subLoan.deleteMany({
        where: { loanId: loanId },
      });

      // 3. Eliminar transactions relacionadas
      await tx.transaction.deleteMany({
        where: { loanId: loanId },
      });

      // 4. Revertir transacción LOAN_DISBURSEMENT en CollectorWallet
      // Buscar la transacción por la descripción que contiene el loanTrack
      const collectorWallet = await this.collectorWalletService.getOrCreateWallet(
        userId,
        tx,
      );
      
      const disbursementTransaction = await tx.collectorWalletTransaction.findFirst({
        where: {
          walletId: collectorWallet.id,
          type: CollectorWalletTransactionType.LOAN_DISBURSEMENT,
          description: {
            contains: loan.loanTrack,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      let updatedCollectorWallet: any = null;
      let collectorWalletReversalTransaction: any = null;

      if (disbursementTransaction) {
        const disbursementAmount = Number(disbursementTransaction.amount);
        const collectorBalanceBefore = Number(collectorWallet.balance);
        const collectorBalanceAfter = collectorBalanceBefore + disbursementAmount;

        // Revertir el balance del CollectorWallet (incrementar)
        updatedCollectorWallet = await tx.collectorWallet.update({
          where: { id: collectorWallet.id },
          data: {
            balance: {
              increment: new Prisma.Decimal(disbursementAmount),
            },
          },
        });

        // Crear transacción de reversión en CollectorWallet
        // Usar CASH_ADJUSTMENT con amount positivo porque estamos devolviendo dinero (sumando al balance)
        collectorWalletReversalTransaction = await tx.collectorWalletTransaction.create({
          data: {
            walletId: collectorWallet.id,
            userId: userId,
            type: CollectorWalletTransactionType.CASH_ADJUSTMENT,
            amount: new Prisma.Decimal(disbursementAmount), // Positivo porque devolvemos dinero
            currency: collectorWallet.currency,
            description: `Devolución desembolso por eliminación de préstamo ${loan.loanTrack}`,
            balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
            balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
          },
        });
      }

      // 5. Devolver dinero a la wallet si hay monto a devolver
      let updatedWallet: any = null;
      let walletTransaction: any = null;

      if (montoADevolver > 0) {
        updatedWallet = await tx.wallet.update({
          where: { id: managerWallet.id },
          data: {
            balance: {
              increment: new Prisma.Decimal(montoADevolver),
            },
          },
        });

        // Registrar la transacción de devolución
        walletTransaction = await tx.walletTransaction.create({
          data: {
            walletId: managerWallet.id,
            userId: userId,
            type: WalletTransactionType.DEPOSIT,
            amount: new Prisma.Decimal(montoADevolver),
            currency: loan.currency,
            description: `Devolución por eliminación de préstamo ${loan.loanTrack}`,
          },
        });
      }

      // 6. Eliminar el préstamo definitivamente (hard delete)
      await tx.loan.delete({
        where: { id: loanId },
      });

      return {
        updatedWallet,
        walletTransaction,
        updatedCollectorWallet,
        collectorWalletReversalTransaction,
        montoDevuelto: montoADevolver,
      };
    });

    return {
      message: 'Préstamo eliminado permanentemente',
      deletedLoan: {
        id: loan.id,
        loanTrack: loan.loanTrack,
        amount: Number(loan.originalAmount), // Monto prestado sin intereses
        clientId: loan.clientId,
        clientName: loan.client.fullName,
        clientDni: loan.client.dni,
        status: loan.status,
        createdAt: loan.createdAt,
        totalPayments: loan.totalPayments,
        paymentFrequency: loan.paymentFrequency,
        baseInterestRate: Number(loan.baseInterestRate),
        currency: loan.currency,
        subLoansCount: loan.subLoans.length,
      },
      montoDevuelto: montoADevolver,
      totalPrestamo,
      totalPagado,
      newWalletBalance: result.updatedWallet
        ? Number(result.updatedWallet.balance)
        : Number(managerWallet.balance),
      newCollectorWalletBalance: result.updatedCollectorWallet
        ? Number(result.updatedCollectorWallet.balance)
        : null,
    };
  }

  /**
   * Obtener estadísticas de préstamos nuevos por período (semana/mes)
   */
  async getLoanStatsByPeriod(
    userId: string,
    userRole: UserRole,
    dateFrom?: string,
    dateTo?: string,
    groupBy: 'week' | 'month' = 'week',
  ) {
    // Determinar préstamos accesibles según rol
    let whereClause: any = {
      deletedAt: null,
    };

    if (userRole === UserRole.MANAGER) {
      // MANAGER solo ve sus préstamos
      whereClause.managerId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN ve préstamos de sus managers
      const managers = await this.prisma.user.findMany({
        where: {
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });

      const managerIds = managers.map((m) => m.id);
      whereClause.managerId = { in: managerIds };
    }
    // ADMIN/SUPERADMIN: no filtran, ven todos

    // Filtros de fecha
    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) {
        whereClause.createdAt.gte = DateUtil.parseToDate(dateFrom);
      }
      if (dateTo) {
        whereClause.createdAt.lte = DateUtil.parseToDate(dateTo);
      }
    }

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        originalAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Agrupar por período
    const statsMap = new Map<string, { count: number; amount: number }>();

    for (const loan of loans) {
      let periodKey: string;

      if (groupBy === 'week') {
        // Formato: "Sem. DD/MM" (inicio de semana) - en zona horaria Argentina
        const dt = DateUtil.fromPrismaDate(loan.createdAt);
        const startOfWeek = dt.startOf('week'); // Luxon usa lunes como inicio de semana

        periodKey = `Sem. ${startOfWeek.day.toString().padStart(2, '0')}/${startOfWeek.month.toString().padStart(2, '0')}`;
      } else {
        // Formato: "YYYY-MM" - en zona horaria Argentina
        const dt = DateUtil.fromPrismaDate(loan.createdAt);
        periodKey = `${dt.year}-${dt.month.toString().padStart(2, '0')}`;
      }

      const existing = statsMap.get(periodKey) || { count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += Number(loan.originalAmount); // Monto prestado sin intereses
      statsMap.set(periodKey, existing);
    }

    // Convertir a array y ordenar
    const stats = Array.from(statsMap.entries())
      .map(([period, data]) => ({
        period,
        count: data.count,
        amount: data.amount,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const totalAmount = loans.reduce(
      (sum, loan) => sum + Number(loan.originalAmount), // Monto prestado sin intereses
      0,
    );

    return {
      total: loans.length,
      totalAmount,
      groupBy,
      stats,
    };
  }

  async getTodayLoans(userId: string, userRole: UserRole) {
    // Obtener la fecha de hoy (inicio y fin del día) usando DateUtil (GMT-3)
    const today = DateUtil.now();
    const startOfDay = DateUtil.startOfDay(today).toJSDate();
    const endOfDay = DateUtil.endOfDay(today).toJSDate();

    // Construir whereClause basado en el rol del usuario
    const whereClause: any = {
      deletedAt: null,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      // MANAGER: solo sus préstamos
      whereClause.managerId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: préstamos de sus managers
      const managedUserIds = await this.getManagedUserIds(userId);
      whereClause.managerId = { in: managedUserIds };
    }
    // ADMIN y SUPERADMIN ven todos los préstamos

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            fullName: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          select: {
            totalAmount: true,
          },
        },
      },
    });

    // Transformar los datos para devolver el formato requerido
    const transformedLoans = loans.map((loan) => {
      const montoTotalADevolver = loan.subLoans.reduce(
        (sum, subLoan) => sum + Number(subLoan.totalAmount),
        0,
      );

      return {
        montoTotalPrestado: Number(loan.originalAmount), // Monto prestado sin intereses
        montoTotalADevolver,
        nombrecliente: loan.client.fullName,
      };
    });

    // Calcular totales
    const total = transformedLoans.length;
    const totalAmount = transformedLoans.reduce(
      (sum, loan) => sum + loan.montoTotalPrestado,
      0,
    );

    // Formatear fecha para la respuesta (usar DateUtil para consistencia)
    const date = DateUtil.now().toFormat('yyyy-MM-dd'); // YYYY-MM-DD

    return {
      date,
      total,
      totalAmount,
      loans: transformedLoans,
    };
  }

  /**
   * Renovar un préstamo: cancela todo el saldo a finalizar del préstamo actual
   * (ingresa a la wallet del manager), lo marca COMPLETED, y crea un nuevo
   * préstamo (egresa de la wallet) con defaults del viejo editables.
   * Todo en una sola transacción atómica.
   */
  async renewLoan(loanId: string, userId: string, dto: RenewLoanDto) {
    // 1. Buscar y validar el préstamo a renovar
    const existingLoan = await this.prisma.loan.findFirst({
      where: { id: loanId, deletedAt: null, managerId: userId },
      include: {
        client: {
          select: { id: true, fullName: true, verified: true },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
        },
      },
    });

    if (!existingLoan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    if (existingLoan.status === LoanStatus.COMPLETED) {
      throw new BadRequestException('El préstamo ya está completado');
    }

    if (!existingLoan.client.verified) {
      throw new BadRequestException(
        `No se puede renovar: el cliente "${existingLoan.client.fullName}" no está verificado`,
      );
    }

    // 2. Calcular saldo pendiente (suma de totalAmount - paidAmount de subloans no PAID)
    const pendingSubLoans = existingLoan.subLoans.filter(
      (sl) => sl.status !== SubLoanStatus.PAID,
    );

    const saldoPendiente = pendingSubLoans.reduce((sum, sl) => {
      const remaining = Math.max(
        0,
        Number(sl.totalAmount) - Number(sl.paidAmount),
      );
      return sum + remaining;
    }, 0);

    if (saldoPendiente <= 0) {
      throw new BadRequestException(
        'El préstamo no tiene saldo pendiente para renovar',
      );
    }

    if (pendingSubLoans.length === 0) {
      throw new BadRequestException(
        'No hay cuotas pendientes para cancelar en este préstamo',
      );
    }

    // 3. Validar que la moneda de la wallet coincida
    const collectorWallet =
      await this.collectorWalletService.getOrCreateWallet(userId);
    if (collectorWallet.currency !== existingLoan.currency) {
      throw new BadRequestException(
        `La wallet de cobros usa ${collectorWallet.currency}, no se puede operar con ${existingLoan.currency}`,
      );
    }

    // 4. Generar código de tracking para el nuevo préstamo (fuera de la tx principal:
    //    TrackingCodeUtil usa su propia $transaction y no podemos anidar)
    const trackingData = await TrackingCodeUtil.generateSequentialTrackingCode(
      this.prisma,
      'CREDITO',
    );

    // 5. Montos del nuevo préstamo
    const newOriginalAmount = Number(dto.amount);
    const newTotalAmount =
      newOriginalAmount * (1 + Number(dto.baseInterestRate));

    // 6. Transacción atómica: cancelar viejo + crear nuevo
    const newLoanId = await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 6a. Marcar todas las subloans pendientes como PAID
        for (const sl of pendingSubLoans) {
          await tx.subLoan.update({
            where: { id: sl.id },
            data: {
              status: SubLoanStatus.PAID,
              paidDate: now,
              paidAmount: new Prisma.Decimal(Number(sl.totalAmount)),
              daysOverdue: 0,
            },
          });
        }

        // 6b. Registrar un único Payment de cancelación anticipada asociado a
        //     la última cuota pendiente (convención para no spammear el historial)
        const lastPending = pendingSubLoans[pendingSubLoans.length - 1];
        await tx.payment.create({
          data: {
            subLoanId: lastPending.id,
            amount: new Prisma.Decimal(saldoPendiente),
            currency: existingLoan.currency,
            paymentDate: now,
            description: `Cancelación anticipada por renovación - ${existingLoan.loanTrack}`,
          },
        });

        // 6c. Marcar el préstamo viejo como COMPLETED
        await tx.loan.update({
          where: { id: existingLoan.id },
          data: {
            status: LoanStatus.COMPLETED,
            completedDate: now,
          },
        });

        // 6d. Acreditar a la cartera principal del manager (LOAN_PAYMENT)
        await this.walletService.credit({
          userId,
          amount: saldoPendiente,
          type: WalletTransactionType.LOAN_PAYMENT,
          description: `Cancelación por renovación ${existingLoan.loanTrack}`,
          transaction: tx,
        });

        // 6d-bis. Acreditar saldoPendiente a la wallet del cobrador (ingreso)
        await this.collectorWalletService.recordCollection({
          userId,
          amount: saldoPendiente,
          description: `Cancelación por renovación ${existingLoan.loanTrack}`,
          subLoanId: lastPending.id,
          transaction: tx,
        });

        // 6d-bis. Recalcular totalCollectedPayments de la ruta del día del manager
        //          para que el "Cobrado" de hoy incluya este pago grande.
        const dayStart = DateUtil.startOfDay(DateUtil.fromJSDate(now)).toJSDate();
        const dayEnd = DateUtil.endOfDay(DateUtil.fromJSDate(now)).toJSDate();
        const paymentsSum = await tx.payment.aggregate({
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            subLoan: { loan: { managerId: userId } },
          },
          _sum: { amount: true },
        });
        await tx.dailyCollectionRoute.updateMany({
          where: { managerId: userId, routeDate: dayStart },
          data: {
            totalCollectedPayments:
              paymentsSum._sum.amount ?? new Prisma.Decimal(0),
          },
        });

        // 6e. Crear el nuevo préstamo
        const firstDueDate = DateUtil.parseToDate(dto.firstDueDate);
        const newLoan = await tx.loan.create({
          data: {
            clientId: existingLoan.clientId,
            managerId: userId,
            amount: newTotalAmount,
            originalAmount: newOriginalAmount,
            currency: existingLoan.currency,
            paymentFrequency: dto.paymentFrequency,
            paymentDay: dto.paymentDay,
            status: LoanStatus.ACTIVE,
            totalPayments: dto.totalPayments,
            firstDueDate,
            loanTrack: trackingData.trackingCode,
            prefix: trackingData.prefix,
            year: trackingData.year,
            sequence: trackingData.sequence,
            description:
              dto.description ?? `Renovación de ${existingLoan.loanTrack}`,
            notes: dto.notes,
            baseInterestRate: dto.baseInterestRate,
            penaltyInterestRate: dto.penaltyInterestRate,
          },
        });

        // 6f. Generar SubLoans del nuevo préstamo
        const generatorPayload = {
          clientId: existingLoan.clientId,
          amount: newOriginalAmount,
          baseInterestRate: dto.baseInterestRate,
          penaltyInterestRate: dto.penaltyInterestRate,
          currency: existingLoan.currency,
          paymentFrequency: dto.paymentFrequency,
          paymentDay: dto.paymentDay,
          totalPayments: dto.totalPayments,
          firstDueDate: dto.firstDueDate,
          description: dto.description,
          notes: dto.notes,
        } as CreateLoanDto;

        await this.subLoanGenerator.generateSubLoans(
          newLoan.id,
          generatorPayload,
          firstDueDate,
          tx,
        );

        // 6g. Débito del capital del nuevo préstamo (egreso)
        await this.collectorWalletService.recordLoanDisbursement({
          userId,
          amount: newOriginalAmount,
          description: `Préstamo ${trackingData.trackingCode} - Renovación de ${existingLoan.loanTrack}`,
          loanId: newLoan.id,
          transaction: tx,
        });

        return newLoan.id;
      },
      {
        maxWait: 30000,
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    // 7. Releer el nuevo préstamo con subloans y cliente para la respuesta
    const newLoan = await this.prisma.loan.findUnique({
      where: { id: newLoanId },
      include: {
        client: {
          select: { id: true, fullName: true, dni: true, cuit: true },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
        },
      },
    });

    // 8. Generar PDF del nuevo préstamo (fuera de la tx, es read-only)
    const pdf = await this.loanPdfService.generateLoanPdf(newLoanId);

    // 9. Normalizar campos Decimal a number para el front
    const transformedNewLoan = newLoan
      ? {
          ...newLoan,
          amount: Number(newLoan.amount),
          originalAmount: Number(newLoan.originalAmount),
          baseInterestRate: Number(newLoan.baseInterestRate),
          penaltyInterestRate: Number(newLoan.penaltyInterestRate),
          subLoans: newLoan.subLoans.map((sl) => ({
            ...sl,
            amount: Number(sl.amount),
            totalAmount: Number(sl.totalAmount),
            paidAmount: Number(sl.paidAmount),
          })),
        }
      : null;

    return {
      previousLoan: {
        id: existingLoan.id,
        loanTrack: existingLoan.loanTrack,
        settledAmount: saldoPendiente,
      },
      newLoan: transformedNewLoan,
      pdfBase64: pdf.pdfBase64,
      pdfFilename: pdf.filename,
    };
  }
}
