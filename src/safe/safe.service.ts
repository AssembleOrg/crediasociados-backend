import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { SafeTransactionType, CollectorWalletTransactionType } from '../common/enums';
import { DateUtil } from '../common/utils/date.util';
import { CollectorWalletService } from '../collector-wallet/collector-wallet.service';
import { DateTime } from 'luxon';

@Injectable()
export class SafeService {
  private readonly logger = new Logger(SafeService.name);

  constructor(
    private prisma: PrismaService,
    private collectorWalletService: CollectorWalletService,
  ) {}

  /**
   * Obtener o crear caja fuerte
   */
  async getOrCreateSafe(
    userId: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<any> {
    const tx = transaction || this.prisma;

    let safe = await tx.safe.findUnique({
      where: { userId },
    });

    if (!safe) {
      this.logger.log(`Creando caja fuerte para usuario ${userId}`);
      safe = await tx.safe.create({
        data: {
          userId,
          balance: new Prisma.Decimal(0),
          currency: 'ARS',
        },
      });
    }

    return safe;
  }

  /**
   * Obtener el SUBADMIN ID del manager
   * Si el usuario es SUBADMIN, retorna su propio ID
   * Si es MANAGER, retorna el createdById (su SUBADMIN)
   */
  private async getSubadminId(
    userId: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<string> {
    const tx = transaction || this.prisma;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, createdById: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Si es SUBADMIN, retorna su propio ID
    if (user.role === UserRole.SUBADMIN) {
      return user.id;
    }

    // Si es MANAGER, retorna el createdById (su SUBADMIN)
    if (user.role === UserRole.MANAGER) {
      if (!user.createdById) {
        throw new BadRequestException(
          'El manager no tiene un SUBADMIN asignado',
        );
      }
      return user.createdById;
    }

    // Para ADMIN y SUPERADMIN, usar su propio ID (aunque no es el caso típico)
    return user.id;
  }

  /**
   * Validar acceso a un manager
   * SUPERADMIN y ADMIN pueden acceder a cualquier manager
   * SUBADMIN solo puede acceder a managers que haya creado
   * MANAGER solo puede acceder a sus propios datos
   */
  async validateManagerAccess(
    managerId: string,
    currentUser: any,
  ): Promise<void> {
    // SUPERADMIN y ADMIN pueden acceder a cualquier manager
    if (
      currentUser.role === UserRole.SUPERADMIN ||
      currentUser.role === UserRole.ADMIN
    ) {
      return;
    }

    // SUBADMIN solo puede acceder a managers que haya creado
    if (currentUser.role === UserRole.SUBADMIN) {
      const manager = await this.prisma.user.findFirst({
        where: {
          id: managerId,
          createdById: currentUser.id,
          deletedAt: null,
        },
      });

      if (!manager) {
        throw new ForbiddenException('No tiene acceso a este manager');
      }
      return;
    }

    // MANAGER solo puede acceder a sus propios datos
    if (currentUser.role === UserRole.MANAGER) {
      if (managerId !== currentUser.id) {
        throw new ForbiddenException(
          'No puede acceder a datos de otros managers',
        );
      }
      return;
    }

    throw new ForbiddenException('Acceso denegado');
  }

  /**
   * Depositar fondos en la caja fuerte
   */
  async deposit(
    userId: string,
    amount: number,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const safe = await this.getOrCreateSafe(userId, tx);
      const balanceBefore = Number(safe.balance);

      // Actualizar balance (permite saldo negativo)
      const updatedSafe = await tx.safe.update({
        where: { id: safe.id },
        data: {
          balance: {
            increment: new Prisma.Decimal(amount),
          },
        },
      });

      const balanceAfter = Number(updatedSafe.balance);

      // Crear transacción
      const transaction = await tx.safeTransaction.create({
        data: {
          safeId: safe.id,
          userId,
          type: SafeTransactionType.DEPOSIT,
          amount: new Prisma.Decimal(amount),
          currency: safe.currency,
          description: description || 'Depósito de fondos',
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      return {
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount),
        balanceBefore,
        balanceAfter,
        description: transaction.description,
        createdAt: transaction.createdAt,
      };
    });
  }

  /**
   * Retirar fondos de la caja fuerte
   */
  async withdraw(
    userId: string,
    amount: number,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const safe = await this.getOrCreateSafe(userId, tx);
      const balanceBefore = Number(safe.balance);

      // Actualizar balance (permite saldo negativo)
      const updatedSafe = await tx.safe.update({
        where: { id: safe.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });

      const balanceAfter = Number(updatedSafe.balance);

      // Crear transacción
      const transaction = await tx.safeTransaction.create({
        data: {
          safeId: safe.id,
          userId,
          type: SafeTransactionType.WITHDRAWAL,
          amount: new Prisma.Decimal(amount),
          currency: safe.currency,
          description: description || 'Retiro de fondos',
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      this.logger.log(
        `Retiro creado: SafeId=${safe.id}, UserId=${userId}, Amount=${amount}, TransactionId=${transaction.id}`,
      );

      return {
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount),
        balanceBefore,
        balanceAfter,
        description: transaction.description,
        createdAt: transaction.createdAt,
      };
    });
  }

  /**
   * Crear gasto personalizado
   * Solo persiste el nombre del gasto. El monto se guarda únicamente en la transacción histórica.
   * Si el nombre ya existe, lo reutiliza. Si no existe, crea uno nuevo.
   */
  async createExpense(
    userId: string,
    name: string,
    amount: number,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const safe = await this.getOrCreateSafe(userId, tx);
      const balanceBefore = Number(safe.balance);

      // Obtener el SUBADMIN ID
      const subadminId = await this.getSubadminId(userId, tx);

      // Buscar gasto existente por nombre (case-insensitive) para el SUBADMIN
      let expense = await tx.safeExpense.findFirst({
        where: {
          subadminId: subadminId,
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      // Si no existe, crear nuevo gasto (solo con nombre, sin monto)
      if (!expense) {
        expense = await tx.safeExpense.create({
          data: {
            subadminId: subadminId,
            name,
            description: description || null,
          },
        });
      }

      // Actualizar balance (decrementar)
      const updatedSafe = await tx.safe.update({
        where: { id: safe.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });

      const balanceAfter = Number(updatedSafe.balance);

      // Crear transacción (aquí se guarda el monto histórico) con referencia a la categoría
      const transaction = await tx.safeTransaction.create({
        data: {
          safeId: safe.id,
          userId,
          type: SafeTransactionType.EXPENSE,
          amount: new Prisma.Decimal(amount),
          currency: safe.currency,
          description: description || `Gasto: ${name}`,
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
          expenseId: expense.id, // Referencia a la categoría de gasto
        },
      });

      this.logger.log(
        `Gasto creado: SafeId=${safe.id}, UserId=${userId}, Amount=${amount}, TransactionId=${transaction.id}`,
      );

      return {
        expense: {
          id: expense.id,
          name: expense.name,
          description: expense.description,
        },
        transaction: {
          id: transaction.id,
          type: transaction.type,
          amount: Number(transaction.amount),
          balanceBefore,
          balanceAfter,
          description: transaction.description,
          expense: {
            id: expense.id,
            name: expense.name,
            description: expense.description,
          },
          createdAt: transaction.createdAt,
        },
      };
    });
  }

  /**
   * Transferir fondos de la caja fuerte a la wallet de cobros
   */
  async transferToCollectorWallet(
    userId: string,
    amount: number,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const safe = await this.getOrCreateSafe(userId, tx);
      
      // Obtener el balance actualizado de la Safe (puede haber cambiado)
      const currentSafe = await tx.safe.findUnique({
        where: { id: safe.id },
      });
      
      if (!currentSafe) {
        throw new NotFoundException('Caja fuerte no encontrada');
      }
      
      const balanceBefore = Number(currentSafe.balance);
      
      this.logger.log(
        `Transferencia a collector wallet: SafeId=${safe.id}, UserId=${userId}, BalanceBefore=${balanceBefore}, Amount=${amount}`,
      );

      // Actualizar balance de la caja fuerte (decrementar)
      const updatedSafe = await tx.safe.update({
        where: { id: safe.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });

      const balanceAfter = Number(updatedSafe.balance);

      // Transferir a la wallet de cobros
      // Obtener o crear collector wallet
      const collectorWallet = await this.collectorWalletService.getOrCreateWallet(
        userId,
        tx,
      );
      const collectorBalanceBefore = Number(collectorWallet.balance);

      // Actualizar balance de collector wallet
      const updatedCollectorWallet = await tx.collectorWallet.update({
        where: { id: collectorWallet.id },
        data: {
          balance: {
            increment: new Prisma.Decimal(amount),
          },
        },
      });

      const collectorBalanceAfter = Number(updatedCollectorWallet.balance);

      // Crear transacción en collector wallet
      await tx.collectorWalletTransaction.create({
        data: {
          walletId: collectorWallet.id,
          userId,
          type: CollectorWalletTransactionType.CASH_ADJUSTMENT,
          amount: new Prisma.Decimal(amount),
          currency: collectorWallet.currency,
          description: description || 'Transferencia desde caja fuerte',
          balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
          balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
        },
      });

      // Crear transacción en la caja fuerte
      const transaction = await tx.safeTransaction.create({
        data: {
          safeId: safe.id,
          userId,
          type: SafeTransactionType.TRANSFER_TO_COLLECTOR,
          amount: new Prisma.Decimal(amount),
          currency: safe.currency,
          description: description || 'Transferencia a wallet de cobros',
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      this.logger.log(
        `Transferencia a collector wallet completada: TransactionId=${transaction.id}, BalanceAfter=${balanceAfter}`,
      );

      return {
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount),
        balanceBefore,
        balanceAfter,
        description: transaction.description,
        createdAt: transaction.createdAt,
      };
    });
  }

  /**
   * Transferir fondos entre cajas fuertes
   */
  async transferBetweenSafes(
    fromUserId: string,
    toManagerId: string,
    amount: number,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      // Verificar que el destinatario existe y es MANAGER
      const targetManager = await tx.user.findUnique({
        where: { id: toManagerId },
      });

      if (!targetManager) {
        throw new NotFoundException('Manager destinatario no encontrado');
      }

      if (targetManager.role !== UserRole.MANAGER) {
        throw new BadRequestException('El destinatario debe ser un MANAGER');
      }

      // Obtener cajas fuertes
      const fromSafe = await this.getOrCreateSafe(fromUserId, tx);
      const toSafe = await this.getOrCreateSafe(toManagerId, tx);

      // Obtener el balance actualizado de la Safe de origen (puede haber cambiado)
      const currentFromSafe = await tx.safe.findUnique({
        where: { id: fromSafe.id },
      });
      const currentToSafe = await tx.safe.findUnique({
        where: { id: toSafe.id },
      });

      if (!currentFromSafe || !currentToSafe) {
        throw new NotFoundException('Una de las cajas fuertes no fue encontrada');
      }

      const fromBalanceBefore = Number(currentFromSafe.balance);
      const toBalanceBefore = Number(currentToSafe.balance);

      this.logger.log(
        `Transferencia entre Safes: FromSafeId=${fromSafe.id} (balance=${fromBalanceBefore}), ToSafeId=${toSafe.id} (balance=${toBalanceBefore}), Amount=${amount}`,
      );

      // Actualizar balances
      const updatedFromSafe = await tx.safe.update({
        where: { id: fromSafe.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });

      const updatedToSafe = await tx.safe.update({
        where: { id: toSafe.id },
        data: {
          balance: {
            increment: new Prisma.Decimal(amount),
          },
        },
      });

      const fromBalanceAfter = Number(updatedFromSafe.balance);
      const toBalanceAfter = Number(updatedToSafe.balance);

      // Crear transacciones en ambas cajas fuertes
      const fromTransaction = await tx.safeTransaction.create({
        data: {
          safeId: fromSafe.id,
          userId: fromUserId,
          type: SafeTransactionType.TRANSFER_TO_SAFE,
          amount: new Prisma.Decimal(amount),
          currency: fromSafe.currency,
          description: description || `Transferencia a ${targetManager.fullName}`,
          balanceBefore: new Prisma.Decimal(fromBalanceBefore),
          balanceAfter: new Prisma.Decimal(fromBalanceAfter),
          relatedUserId: toManagerId,
          relatedSafeId: toSafe.id,
        },
      });

      const toTransaction = await tx.safeTransaction.create({
        data: {
          safeId: toSafe.id,
          userId: toManagerId,
          type: SafeTransactionType.TRANSFER_FROM_SAFE,
          amount: new Prisma.Decimal(amount),
          currency: toSafe.currency,
          description: description || `Transferencia desde ${fromUserId}`,
          balanceBefore: new Prisma.Decimal(toBalanceBefore),
          balanceAfter: new Prisma.Decimal(toBalanceAfter),
          relatedUserId: fromUserId,
          relatedSafeId: fromSafe.id,
        },
      });

      this.logger.log(
        `Transferencia completada: FromTransactionId=${fromTransaction.id}, ToTransactionId=${toTransaction.id}`,
      );

      return {
        fromTransaction: {
          id: fromTransaction.id,
          type: fromTransaction.type,
          amount: Number(fromTransaction.amount),
          balanceBefore: fromBalanceBefore,
          balanceAfter: fromBalanceAfter,
          description: fromTransaction.description,
          createdAt: fromTransaction.createdAt,
        },
        toTransaction: {
          id: toTransaction.id,
          type: toTransaction.type,
          amount: Number(toTransaction.amount),
          balanceBefore: toBalanceBefore,
          balanceAfter: toBalanceAfter,
          description: toTransaction.description,
          createdAt: toTransaction.createdAt,
        },
      };
    });
  }

  /**
   * Obtener historial de transacciones con paginación y filtros
   */
  async getHistory(
    userId: string,
    page: number = 1,
    limit: number = 50,
    startDate?: string,
    endDate?: string,
    type?: SafeTransactionType,
    managerId?: string,
    currentUser?: any,
  ): Promise<any> {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = userId;
    if (managerId) {
      // Validar acceso al manager
      await this.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }
    
    const safe = await this.getOrCreateSafe(targetUserId);
    const skip = (page - 1) * limit;

    this.logger.log(
      `Consultando historial: SafeId=${safe.id}, UserId=${targetUserId}, Page=${page}, Limit=${limit}`,
    );

    const where: any = {
      safeId: safe.id,
    };

    // Filtro por tipo
    if (type) {
      where.type = type;
    }

    // Filtro por fecha
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        const start = DateUtil.parseToDate(startDate);
        where.createdAt.gte = DateTime.fromJSDate(start)
          .startOf('day')
          .toJSDate();
      }
      if (endDate) {
        const end = DateUtil.parseToDate(endDate);
        where.createdAt.lte = DateTime.fromJSDate(end)
          .endOf('day')
          .toJSDate();
      }
    }

    const [transactions, total] = await Promise.all([
      this.prisma.safeTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          expense: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
        },
      }),
      this.prisma.safeTransaction.count({ where }),
    ]);

    this.logger.log(
      `Historial encontrado: ${transactions.length} transacciones de ${total} totales para SafeId=${safe.id}`,
    );
    this.logger.log(
      `Transacciones encontradas: ${transactions.map((t) => `${t.type}(${t.id})`).join(', ')}`,
    );
    
    // Verificar si hay transferencias que no aparecen
    const transferCount = await this.prisma.safeTransaction.count({
      where: {
        safeId: safe.id,
        type: {
          in: [SafeTransactionType.TRANSFER_TO_SAFE, SafeTransactionType.TRANSFER_FROM_SAFE],
        },
      },
    });
    if (transferCount > 0 && transferCount !== transactions.filter(t => 
      t.type === SafeTransactionType.TRANSFER_TO_SAFE || 
      t.type === SafeTransactionType.TRANSFER_FROM_SAFE
    ).length) {
      this.logger.warn(
        `⚠️ Hay ${transferCount} transferencias en esta Safe, pero solo ${transactions.filter(t => 
          t.type === SafeTransactionType.TRANSFER_TO_SAFE || 
          t.type === SafeTransactionType.TRANSFER_FROM_SAFE
        ).length} aparecen en el historial`,
      );
    }

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        currency: tx.currency,
        description: tx.description,
        balanceBefore: Number(tx.balanceBefore),
        balanceAfter: Number(tx.balanceAfter),
        relatedUserId: tx.relatedUserId,
        relatedSafeId: tx.relatedSafeId,
        expense: tx.expense ? {
          id: tx.expense.id,
          name: tx.expense.name,
          description: tx.expense.description,
        } : null,
        createdAt: tx.createdAt,
        user: tx.user,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
      currentBalance: Number(safe.balance),
    };
  }

  /**
   * Obtener balance actual
   */
  async getBalance(userId: string): Promise<any> {
    const safe = await this.getOrCreateSafe(userId);
    return {
      balance: Number(safe.balance),
      currency: safe.currency,
    };
  }

  /**
   * Crear categoría de gasto (solo nombre y descripción, sin monto ni transacción)
   * Las categorías son compartidas por todos los managers del SUBADMIN
   */
  async createExpenseCategory(
    userId: string,
    name: string,
    description?: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      // Obtener el SUBADMIN ID
      const subadminId = await this.getSubadminId(userId, tx);

      // Verificar si ya existe una categoría con ese nombre (case-insensitive)
      const existingExpense = await tx.safeExpense.findFirst({
        where: {
          subadminId: subadminId,
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      if (existingExpense) {
        throw new BadRequestException(
          `Ya existe una categoría con el nombre "${name}"`,
        );
      }

      // Crear nueva categoría
      const expense = await tx.safeExpense.create({
        data: {
          subadminId: subadminId,
          name,
          description: description || null,
        },
      });

      return {
        id: expense.id,
        name: expense.name,
        description: expense.description,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
      };
    });
  }

  /**
   * Obtener gastos guardados (compartidos por todos los managers del SUBADMIN)
   * Solo retorna el nombre, el monto se encuentra en las transacciones históricas
   */
  async getExpenses(userId: string): Promise<any> {
    const subadminId = await this.getSubadminId(userId);
    const expenses = await this.prisma.safeExpense.findMany({
      where: { subadminId: subadminId },
      orderBy: { name: 'asc' },
    });

    return expenses.map((expense) => ({
      id: expense.id,
      name: expense.name,
      description: expense.description,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    }));
  }

  /**
   * Obtener un gasto por ID
   * Solo retorna el nombre, el monto se encuentra en las transacciones históricas
   */
  async getExpenseById(userId: string, expenseId: string): Promise<any> {
    const subadminId = await this.getSubadminId(userId);
    const expense = await this.prisma.safeExpense.findFirst({
      where: {
        id: expenseId,
        subadminId: subadminId,
      },
    });

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    return {
      id: expense.id,
      name: expense.name,
      description: expense.description,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    };
  }

  /**
   * Actualizar un gasto
   * Solo permite actualizar nombre y descripción. El monto no se persiste en el gasto,
   * solo en las transacciones históricas.
   */
  async updateExpense(
    userId: string,
    expenseId: string,
    updateData: { name?: string; description?: string },
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const subadminId = await this.getSubadminId(userId, tx);
      
      // Verificar que el gasto existe y pertenece al SUBADMIN
      const existingExpense = await tx.safeExpense.findFirst({
        where: {
          id: expenseId,
          subadminId: subadminId,
        },
      });

      if (!existingExpense) {
        throw new NotFoundException('Gasto no encontrado');
      }

      // Si se cambia el nombre, verificar que no exista otro gasto con ese nombre
      if (updateData.name && updateData.name !== existingExpense.name) {
        const duplicateExpense = await tx.safeExpense.findFirst({
          where: {
            subadminId: subadminId,
            name: {
              equals: updateData.name,
              mode: 'insensitive',
            },
            id: {
              not: expenseId,
            },
          },
        });

        if (duplicateExpense) {
          throw new BadRequestException(
            `Ya existe un gasto con el nombre "${updateData.name}"`,
          );
        }
      }

      // Actualizar el gasto (solo nombre y descripción, el monto no se persiste)
      const updatedExpense = await tx.safeExpense.update({
        where: { id: expenseId },
        data: {
          ...(updateData.name && { name: updateData.name }),
          ...(updateData.description !== undefined && {
            description: updateData.description,
          }),
          updatedAt: new Date(),
        },
      });

      return {
        id: updatedExpense.id,
        name: updatedExpense.name,
        description: updatedExpense.description,
        createdAt: updatedExpense.createdAt,
        updatedAt: updatedExpense.updatedAt,
      };
    });
  }

  /**
   * Eliminar un gasto
   */
  async deleteExpense(userId: string, expenseId: string): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      const subadminId = await this.getSubadminId(userId, tx);

      // Verificar que el gasto existe y pertenece al SUBADMIN
      const expense = await tx.safeExpense.findFirst({
        where: {
          id: expenseId,
          subadminId: subadminId,
        },
      });

      if (!expense) {
        throw new NotFoundException('Gasto no encontrado');
      }

      // Eliminar el gasto
      await tx.safeExpense.delete({
        where: { id: expenseId },
      });

      return {
        message: 'Gasto eliminado exitosamente',
        deletedExpense: {
          id: expense.id,
          name: expense.name,
        },
      };
    });
  }
}

