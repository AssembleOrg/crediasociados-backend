import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanFiltersDto, LoanChartDataDto } from '../common/dto';
import { DateUtil, TrackingCodeUtil } from '../common/utils';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { Prisma, UserRole } from '@prisma/client';
import { LoanStatus, WalletTransactionType } from 'src/common/enums';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private subLoanGenerator: SubLoanGeneratorService,
    private walletService: WalletService,
  ) {}

  async createLoan(createLoanDto: CreateLoanDto, userId: string) {
    // 1. Verificar si el cliente existe y es gestionado por el usuario
    const clientManager = await this.prisma.clientManager.findFirst({
      where: {
        clientId: createLoanDto.clientId,
        userId: userId,
        deletedAt: null,
      },
    });

    if (!clientManager) {
      throw new BadRequestException(
        'Cliente no encontrado o no gestionado por el usuario',
      );
    }

    // 2. Verificar que el manager tenga saldo suficiente en su cartera
    const wallet = await this.walletService.getUserWallet(userId);

    if (Number(wallet.balance) < createLoanDto.amount) {
      throw new BadRequestException(
        `Saldo insuficiente en cartera. Disponible: ${Number(wallet.balance)}, Requerido: ${createLoanDto.amount}`,
      );
    }

    // 3. Validar que la moneda del préstamo coincida con la de la cartera
    if (wallet.currency !== createLoanDto.currency) {
      throw new BadRequestException(
        `La cartera usa ${wallet.currency}, no se puede prestar en ${createLoanDto.currency}`,
      );
    }

    // Generar o usar el código de tracking
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

    // 4. Usar transacción para crear el loan, subloans y debitar de cartera
    const result = await this.prisma.$transaction(async (prisma) => {
      // Crear el préstamo
      const loan = await prisma.loan.create({
        data: {
          clientId: createLoanDto.clientId,
          managerId: userId, // NUEVO: Agregar manager ID
          amount: createLoanDto.amount,
          originalAmount: createLoanDto.amount,
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

      // NUEVO: Debitar de la cartera del manager
      await this.walletService.debit({
        userId,
        amount: createLoanDto.amount,
        type: WalletTransactionType.LOAN_DISBURSEMENT,
        description: `Préstamo ${loanTrack} - ${createLoanDto.description || 'Desembolso'}`,
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
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            totalAmount: true,
            status: true,
            dueDate: true,
            paidDate: true,
            paidAmount: true,
            daysOverdue: true,
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
    // Get all active loans based on user role and hierarchy
    const loans = await this.prisma.loan.findMany({
      where: {
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return loans;
  }

  async getAllLoans(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Get loans based on user role and hierarchy
    const loans = await this.prisma.loan.findMany({
      where: {
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
        client: {
          managers: {
            some: {
              userId: userId,
              deletedAt: null,
            },
          },
        },
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
        client: {
          managers: {
            some: {
              userId: userId,
              deletedAt: null,
            },
          },
        },
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
      // MANAGER: solo sus clientes
      whereClause.client = {
        managers: {
          some: {
            userId: userId,
            deletedAt: null,
          },
        },
      };
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: clientes de sus managers
      const managedUserIds = await this.getManagedUserIds(userId);
      whereClause.client = {
        managers: {
          some: {
            userId: { in: managedUserIds },
            deletedAt: null,
          },
        },
      };
    }
    // ADMIN y SUPERADMIN ven todos los préstamos

    // Aplicar filtros adicionales
    if (filters.managerId) {
      whereClause.client = {
        ...whereClause.client,
        managers: {
          some: {
            userId: filters.managerId,
            deletedAt: null,
          },
        },
      };
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
      whereClause.client = {
        managers: {
          some: {
            userId: userId,
            deletedAt: null,
          },
        },
      };
    } else if (userRole === UserRole.SUBADMIN) {
      const managedUserIds = await this.getManagedUserIds(userId);
      whereClause.client = {
        managers: {
          some: {
            userId: { in: managedUserIds },
            deletedAt: null,
          },
        },
      };
    }

    // Aplicar filtros adicionales
    if (filters.managerId) {
      whereClause.client = {
        ...whereClause.client,
        managers: {
          some: {
            userId: filters.managerId,
            deletedAt: null,
          },
        },
      };
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
}
