import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CollectorWalletTransactionType } from '../common/enums';

@Injectable()
export class CollectorWalletService {
  private readonly logger = new Logger(CollectorWalletService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Obtener o crear wallet de cobrador
   */
  async getOrCreateWallet(
    userId: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<any> {
    const tx = transaction || this.prisma;

    let wallet = await tx.collectorWallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      this.logger.log(`Creando collector wallet para usuario ${userId}`);
      wallet = await tx.collectorWallet.create({
        data: {
          userId,
          balance: new Prisma.Decimal(0),
          currency: 'ARS',
        },
      });
    }

    return wallet;
  }

  /**
   * Obtener balance de la wallet de cobrador
   */
  async getBalance(userId: string): Promise<any> {
    const wallet = await this.getOrCreateWallet(userId);

    return {
      walletId: wallet.id,
      balance: Number(wallet.balance),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }

  /**
   * Registrar un cobro en la wallet (uso interno, llamado desde payments.service)
   * IMPORTANTE: Este método debe ser llamado dentro de una transacción
   */
  async recordCollection(params: {
    userId: string;
    amount: number;
    description: string;
    subLoanId: string;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    const { userId, amount, description, subLoanId, transaction } = params;

    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Obtener o crear wallet
    const wallet = await this.getOrCreateWallet(userId, transaction);
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + amount;

    // Actualizar balance usando increment para atomicidad
    await transaction.collectorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          increment: new Prisma.Decimal(amount),
        },
      },
    });

    // Registrar transacción con balances
    await transaction.collectorWalletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type: CollectorWalletTransactionType.COLLECTION,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
        subLoanId,
      },
    });

    this.logger.log(
      `Cobro registrado: Usuario ${userId}, Monto ${amount}, Nuevo balance ${balanceAfter}`,
    );
  }

  /**
   * Realizar un retiro de la wallet de cobrador
   * IMPORTANTE: Valida que el saldo nunca pueda quedar negativo
   */
  async withdraw(
    userId: string,
    amount: number,
    description: string,
  ): Promise<any> {
    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Usar transacción atómica para el retiro
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Obtener wallet con lock para evitar condiciones de carrera
        const wallet = await tx.collectorWallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet de cobrador no encontrada');
        }

        const currentBalance = Number(wallet.balance);

        // Validación crítica: no permitir saldo negativo
        if (currentBalance < amount) {
          throw new BadRequestException(
            `Saldo insuficiente. Disponible: ${currentBalance}, Solicitado: ${amount}`,
          );
        }

        const balanceBefore = currentBalance;
        const balanceAfter = currentBalance - amount;

        // Actualizar balance usando decrement para atomicidad
        const updatedWallet = await tx.collectorWallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              decrement: new Prisma.Decimal(amount),
            },
          },
        });

        // Validación adicional después de la actualización
        if (Number(updatedWallet.balance) < 0) {
          throw new BadRequestException(
            'Error: El saldo no puede ser negativo. Operación abortada.',
          );
        }

        // Registrar transacción de retiro
        const transaction = await tx.collectorWalletTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            type: CollectorWalletTransactionType.WITHDRAWAL,
            amount: new Prisma.Decimal(amount),
            currency: wallet.currency,
            description,
            balanceBefore: new Prisma.Decimal(balanceBefore),
            balanceAfter: new Prisma.Decimal(balanceAfter),
          },
        });

        this.logger.log(
          `Retiro exitoso: Usuario ${userId}, Monto ${amount}, Nuevo balance ${balanceAfter}`,
        );

        return {
          transaction,
          wallet: updatedWallet,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      transactionId: result.transaction.id,
      amount: Number(result.transaction.amount),
      balanceBefore: Number(result.transaction.balanceBefore),
      balanceAfter: Number(result.transaction.balanceAfter),
      description: result.transaction.description,
      createdAt: result.transaction.createdAt,
    };
  }

  /**
   * Obtener historial de transacciones de la wallet de cobrador
   */
  async getTransactions(
    userId: string,
    page: number = 1,
    limit: number = 50,
    type?: CollectorWalletTransactionType,
  ): Promise<any> {
    const wallet = await this.getOrCreateWallet(userId);

    const skip = (page - 1) * limit;

    const where: any = {
      walletId: wallet.id,
    };

    if (type) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.collectorWalletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.collectorWalletTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        currency: t.currency,
        description: t.description,
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        subLoanId: t.subLoanId,
        createdAt: t.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtener resumen de la wallet (balance + estadísticas)
   */
  async getSummary(userId: string): Promise<any> {
    const wallet = await this.getOrCreateWallet(userId);

    // Obtener estadísticas de cobros y retiros
    const [collectionsSum, withdrawalsSum, transactionCount] =
      await Promise.all([
        this.prisma.collectorWalletTransaction.aggregate({
          where: {
            walletId: wallet.id,
            type: CollectorWalletTransactionType.COLLECTION,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.collectorWalletTransaction.aggregate({
          where: {
            walletId: wallet.id,
            type: CollectorWalletTransactionType.WITHDRAWAL,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.collectorWalletTransaction.count({
          where: { walletId: wallet.id },
        }),
      ]);

    return {
      walletId: wallet.id,
      currentBalance: Number(wallet.balance),
      currency: wallet.currency,
      totalCollected: Number(collectionsSum._sum.amount || 0),
      totalWithdrawn: Number(withdrawalsSum._sum.amount || 0),
      transactionCount,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  /**
   * Obtener reporte del período para cobradores
   */
  async getPeriodReport(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    managerId?: string,
  ): Promise<any> {
    // Determinar el usuario objetivo (managerId si se proporciona, de lo contrario userId)
    const targetUserId = managerId || userId;

    // Si no se proporcionan fechas, calcular la semana actual
    let periodStart: Date;
    let periodEnd: Date;

    if (!startDate || !endDate) {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
      
      // Calcular inicio de semana (lunes)
      const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
      periodStart = new Date(now);
      periodStart.setDate(now.getDate() - daysFromMonday);
      periodStart.setHours(0, 0, 0, 0);

      // Calcular fin de semana (domingo)
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      periodStart = new Date(startDate);
      periodStart.setHours(0, 0, 0, 0);
      
      periodEnd = new Date(endDate);
      periodEnd.setHours(23, 59, 59, 999);
    }

    // Obtener wallet del usuario objetivo
    const wallet = await this.getOrCreateWallet(targetUserId);

    // Obtener usuario objetivo con su % de comisión
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { commission: true, fullName: true, email: true, role: true },
    });

    // 1. Historial de transacciones de collector wallet del período
    const collectorWalletTransactions =
      await this.prisma.collectorWalletTransaction.findMany({
        where: {
          walletId: wallet.id,
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

    // 2. Suma de cobros y retiros del período
    const totalCollections = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.COLLECTION)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalWithdrawals = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.WITHDRAWAL)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const netCollectorWallet = totalCollections - totalWithdrawals;

    // 3. Obtener todos los pagos realizados por este cobrador en el período
    const paymentsRegistered = await this.prisma.payment.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
        subLoan: {
          loan: {
            client: {
              managers: {
                some: {
                  userId: targetUserId,
                  deletedAt: null,
                },
              },
            },
          },
        },
      },
      include: {
        subLoan: {
          include: {
            loan: {
              include: {
                client: true,
              },
            },
          },
        },
      },
    });

    // 4. Obtener todos los subloans que deberían haberse cobrado en el período
    // (todos los subloans del cobrador con dueDate en el período)
    const subloansDue = await this.prisma.subLoan.findMany({
      where: {
        dueDate: {
          gte: periodStart,
          lte: periodEnd,
        },
        loan: {
          client: {
            managers: {
              some: {
                userId: targetUserId,
                deletedAt: null,
              },
            },
          },
        },
        deletedAt: null,
      },
      include: {
        loan: {
          include: {
            client: true,
          },
        },
      },
    });

    // 5. Calcular estadísticas de cobros
    const totalDue = subloansDue.length;
    const collectedFull = subloansDue.filter(
      (sl) => sl.status === 'PAID',
    ).length;
    const collectedPartial = subloansDue.filter(
      (sl) => sl.status === 'PARTIAL',
    ).length;
    const collectedTotal = collectedFull + collectedPartial;
    const failed = totalDue - collectedTotal;

    const percentageCollectedFull =
      totalDue > 0 ? (collectedFull / totalDue) * 100 : 0;
    const percentageCollectedPartial =
      totalDue > 0 ? (collectedPartial / totalDue) * 100 : 0;
    const percentageFailed = totalDue > 0 ? (failed / totalDue) * 100 : 0;

    // Montos totales de cobros
    const totalAmountDue = subloansDue.reduce(
      (sum, sl) => sum + Number(sl.totalAmount),
      0,
    );
    const totalAmountCollected = paymentsRegistered.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // 6. Obtener gastos del período
    // 6a. Gastos de daily closures (sistema antiguo)
    const dailyClosures = await this.prisma.dailyClosure.findMany({
      where: {
        userId: targetUserId,
        closureDate: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      include: {
        expenses: true,
      },
    });

    // 6b. Gastos de collection routes (sistema nuevo)
    const collectionRoutes = await this.prisma.dailyCollectionRoute.findMany({
      where: {
        managerId: targetUserId,
        routeDate: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      include: {
        expenses: true,
      },
    });

    const expensesByCategory: { [key: string]: number } = {};
    const expensesDetail: any[] = [];
    let totalExpenses = 0;

    // Procesar gastos de daily closures
    dailyClosures.forEach((closure) => {
      closure.expenses.forEach((expense) => {
        const category = expense.category;
        const amount = Number(expense.amount);

        if (!expensesByCategory[category]) {
          expensesByCategory[category] = 0;
        }
        expensesByCategory[category] += amount;
        totalExpenses += amount;

        expensesDetail.push({
          category,
          amount,
          description: expense.description,
          date: closure.closureDate,
          source: 'daily_closure',
        });
      });
    });

    // Procesar gastos de collection routes
    collectionRoutes.forEach((route) => {
      route.expenses.forEach((expense) => {
        const category = expense.category;
        const amount = Number(expense.amount);

        if (!expensesByCategory[category]) {
          expensesByCategory[category] = 0;
        }
        expensesByCategory[category] += amount;
        totalExpenses += amount;

        expensesDetail.push({
          category,
          amount,
          description: expense.description,
          date: route.routeDate,
          source: 'collection_route',
        });
      });
    });

    // 7. Calcular comisión automática
    const commissionPercentage = user?.commission ? Number(user.commission) : 0;
    const commissionAmount = (netCollectorWallet * commissionPercentage) / 100;

    // Construir respuesta
    return {
      period: {
        startDate: periodStart.toISOString(),
        endDate: periodEnd.toISOString(),
      },
      collector: {
        userId: user?.email || userId,
        fullName: user?.fullName,
        role: user?.role,
        commissionPercentage,
      },
      collectorWallet: {
        transactions: collectorWalletTransactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          balanceBefore: Number(t.balanceBefore),
          balanceAfter: Number(t.balanceAfter),
          subLoanId: t.subLoanId,
          createdAt: t.createdAt,
        })),
        totalCollections,
        totalWithdrawals,
        netAmount: netCollectorWallet,
      },
      collections: {
        totalDue,
        collected: {
          full: collectedFull,
          partial: collectedPartial,
          total: collectedTotal,
        },
        failed,
        percentages: {
          full: Number(percentageCollectedFull.toFixed(2)),
          partial: Number(percentageCollectedPartial.toFixed(2)),
          failed: Number(percentageFailed.toFixed(2)),
        },
        amounts: {
          totalDue: totalAmountDue,
          totalCollected: totalAmountCollected,
        },
      },
      expenses: {
        total: totalExpenses,
        byCategory: expensesByCategory,
        detail: expensesDetail,
      },
      commission: {
        percentage: commissionPercentage,
        baseAmount: netCollectorWallet,
        commissionAmount: Number(commissionAmount.toFixed(2)),
      },
      summary: {
        totalCollections,
        totalWithdrawals,
        totalExpenses,
        netBeforeCommission: netCollectorWallet,
        commission: Number(commissionAmount.toFixed(2)),
        netAfterCommission: Number(
          (netCollectorWallet - commissionAmount).toFixed(2),
        ),
      },
    };
  }

  /**
   * Obtener resumen diario para manager
   * Incluye: cobrado, prestado y gastos del día en GMT-3
   */
  async getDailySummary(
    userId: string,
    date?: Date,
  ): Promise<any> {
    // Calcular inicio y fin del día en GMT-3 (Argentina)
    let dayStart: Date;
    let dayEnd: Date;

    if (date) {
      // Si se proporciona fecha, usarla
      dayStart = new Date(date);
    } else {
      // Si no, usar fecha actual en GMT-3
      dayStart = new Date();
    }

    // Establecer inicio del día en GMT-3
    // JavaScript trabaja en hora local del servidor, ajustamos a GMT-3
    dayStart.setHours(0, 0, 0, 0);
    
    // Establecer fin del día en GMT-3
    dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    // Obtener información del usuario
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true,
        fullName: true, 
        email: true, 
        role: true,
        createdById: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // 1. COBRADO del día (de collector wallet)
    const collectorWallet = await this.getOrCreateWallet(userId);
    
    const collectionsToday = await this.prisma.collectorWalletTransaction.findMany({
      where: {
        walletId: collectorWallet.id,
        type: CollectorWalletTransactionType.COLLECTION,
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    });

    const totalCollected = collectionsToday.reduce(
      (sum, t) => sum + Number(t.amount),
      0,
    );

    // 2. PRESTADO del día (loans creados)
    const loansCreatedToday = await this.prisma.loan.findMany({
      where: {
        managerId: userId,
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        deletedAt: null,
      },
      select: {
        id: true,
        loanTrack: true,
        amount: true,
        currency: true,
        client: {
          select: {
            fullName: true,
          },
        },
        createdAt: true,
      },
    });

    const totalLoaned = loansCreatedToday.reduce(
      (sum, loan) => sum + Number(loan.amount),
      0,
    );

    // 3. GASTOS del día (de collection routes y daily closures)
    const collectionRoutesToday = await this.prisma.dailyCollectionRoute.findMany({
      where: {
        managerId: userId,
        routeDate: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      include: {
        expenses: true,
      },
    });

    const dailyClosuresToday = await this.prisma.dailyClosure.findMany({
      where: {
        userId: userId,
        closureDate: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      include: {
        expenses: true,
      },
    });

    let totalExpenses = 0;
    const expensesByCategory: { [key: string]: number } = {};
    const expensesDetail: any[] = [];

    // Procesar gastos de collection routes
    collectionRoutesToday.forEach((route) => {
      route.expenses.forEach((expense) => {
        const category = expense.category;
        const amount = Number(expense.amount);

        if (!expensesByCategory[category]) {
          expensesByCategory[category] = 0;
        }
        expensesByCategory[category] += amount;
        totalExpenses += amount;

        expensesDetail.push({
          category,
          amount,
          description: expense.description,
          source: 'collection_route',
          createdAt: expense.createdAt,
        });
      });
    });

    // Procesar gastos de daily closures
    dailyClosuresToday.forEach((closure) => {
      closure.expenses.forEach((expense) => {
        const category = expense.category;
        const amount = Number(expense.amount);

        if (!expensesByCategory[category]) {
          expensesByCategory[category] = 0;
        }
        expensesByCategory[category] += amount;
        totalExpenses += amount;

        expensesDetail.push({
          category,
          amount,
          description: expense.description,
          source: 'daily_closure',
          createdAt: expense.createdAt,
        });
      });
    });

    // Calcular balance neto del día
    const netBalance = totalCollected - totalLoaned - totalExpenses;

    return {
      date: {
        requested: dayStart.toISOString(),
        start: dayStart.toISOString(),
        end: dayEnd.toISOString(),
      },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      collected: {
        total: totalCollected,
        count: collectionsToday.length,
        transactions: collectionsToday.map((t) => ({
          id: t.id,
          amount: Number(t.amount),
          description: t.description,
          subLoanId: t.subLoanId,
          createdAt: t.createdAt,
        })),
      },
      loaned: {
        total: totalLoaned,
        count: loansCreatedToday.length,
        loans: loansCreatedToday.map((loan) => ({
          id: loan.id,
          loanTrack: loan.loanTrack,
          amount: Number(loan.amount),
          currency: loan.currency,
          clientName: loan.client.fullName,
          createdAt: loan.createdAt,
        })),
      },
      expenses: {
        total: totalExpenses,
        count: expensesDetail.length,
        byCategory: expensesByCategory,
        detail: expensesDetail,
      },
      summary: {
        totalCollected,
        totalLoaned,
        totalExpenses,
        netBalance,
      },
    };
  }
}

