import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { CollectorWalletTransactionType, SafeTransactionType } from '../common/enums';
import { DateUtil } from '../common/utils/date.util';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionType } from '../common/enums';
import { DateTime } from 'luxon';

@Injectable()
export class CollectorWalletService {
  private readonly logger = new Logger(CollectorWalletService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

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
   * Recalcular balance basándose en las transacciones
   */
  async recalculateBalance(userId: string): Promise<any> {
    const wallet = await this.getOrCreateWallet(userId);

    // Obtener todas las transacciones ordenadas por fecha (sin límite de fechas)
    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'asc' },
    });

    // Calcular balance basándose en las transacciones
    // PAYMENT_RESET tiene amount negativo, así que se suma directamente (ya que amount es negativo, sumar es restar)
    let calculatedBalance = 0;
    for (const transaction of transactions) {
      if (
        transaction.type === CollectorWalletTransactionType.COLLECTION ||
        transaction.type === CollectorWalletTransactionType.CASH_ADJUSTMENT ||
        transaction.type === CollectorWalletTransactionType.PAYMENT_RESET
      ) {
        // COLLECTION y CASH_ADJUSTMENT tienen amount positivo, PAYMENT_RESET tiene amount negativo
        // Al sumar directamente, PAYMENT_RESET resta correctamente
        calculatedBalance += Number(transaction.amount);
      } else if (
        transaction.type === CollectorWalletTransactionType.WITHDRAWAL ||
        transaction.type === CollectorWalletTransactionType.ROUTE_EXPENSE ||
        transaction.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT
      ) {
        calculatedBalance -= Number(transaction.amount);
      }
    }

    // Si el balance calculado es diferente al almacenado, actualizarlo
    const storedBalance = Number(wallet.balance);
    if (Math.abs(calculatedBalance - storedBalance) > 0.01) {
      this.logger.warn(
        `Balance desincronizado para usuario ${userId}. Almacenado: ${storedBalance}, Calculado: ${calculatedBalance}. Actualizando...`,
      );

      await this.prisma.collectorWallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(calculatedBalance),
        },
      });

      return {
        walletId: wallet.id,
        balance: calculatedBalance,
        currency: wallet.currency,
        updatedAt: new Date(),
        recalculated: true,
        previousBalance: storedBalance,
      };
    }

    return {
      walletId: wallet.id,
      balance: calculatedBalance,
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
      recalculated: false,
    };
  }

  /**
   * Obtener balance agregado de todos los managers de un SUBADMIN
   * Calcula el balance total basándose en TODAS las transacciones (sin límite de fechas)
   */
  async getSubadminAggregatedBalance(userId: string): Promise<any> {
    // Obtener todos los managers creados por este SUBADMIN
    const managedUsers = await this.prisma.user.findMany({
      where: {
        createdById: userId,
        role: UserRole.MANAGER,
        deletedAt: null,
      },
      select: { id: true },
    });

    const managedUserIds = managedUsers.map((u) => u.id);

    if (managedUserIds.length === 0) {
      return {
        walletId: null,
        balance: 0,
        currency: 'ARS',
        updatedAt: new Date(),
        managersCount: 0,
      };
    }

    // Obtener todas las wallets de los managers
    const wallets = await this.prisma.collectorWallet.findMany({
      where: {
        userId: { in: managedUserIds },
      },
      select: { id: true },
    });

    const walletIds = wallets.map((w) => w.id);

    if (walletIds.length === 0) {
      return {
        walletId: null,
        balance: 0,
        currency: 'ARS',
        updatedAt: new Date(),
        managersCount: managedUserIds.length,
      };
    }

    // Obtener TODAS las transacciones de todos los managers (sin límite de fechas)
    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: { walletId: { in: walletIds } },
      orderBy: { createdAt: 'asc' },
    });

    // Calcular balance total basándose en todas las transacciones
    // PAYMENT_RESET tiene amount negativo, así que se suma directamente (ya que amount es negativo, sumar es restar)
    let totalBalance = 0;
    for (const transaction of transactions) {
      if (
        transaction.type === CollectorWalletTransactionType.COLLECTION ||
        transaction.type === CollectorWalletTransactionType.CASH_ADJUSTMENT ||
        transaction.type === CollectorWalletTransactionType.PAYMENT_RESET
      ) {
        // COLLECTION y CASH_ADJUSTMENT tienen amount positivo, PAYMENT_RESET tiene amount negativo
        // Al sumar directamente, PAYMENT_RESET resta correctamente
        totalBalance += Number(transaction.amount);
      } else if (
        transaction.type === CollectorWalletTransactionType.WITHDRAWAL ||
        transaction.type === CollectorWalletTransactionType.ROUTE_EXPENSE ||
        transaction.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT
      ) {
        totalBalance -= Number(transaction.amount);
      }
    }

    return {
      walletId: null,
      balance: totalBalance,
      currency: 'ARS',
      updatedAt: new Date(),
      managersCount: managedUserIds.length,
      transactionsCount: transactions.length,
    };
  }

  /**
   * Obtener balance de la wallet de cobrador
   * Para MANAGER: devuelve su balance
   * Para SUBADMIN: devuelve el balance agregado de todos sus managers
   * Recalcula el balance si hay discrepancia
   */
  async getBalance(userId: string, userRole: UserRole): Promise<any> {
    // Si es SUBADMIN, devolver balance agregado de sus managers
    if (userRole === UserRole.SUBADMIN) {
      return this.getSubadminAggregatedBalance(userId);
    }

    // Para MANAGER, ADMIN, SUPERADMIN: devolver su propia wallet
    const wallet = await this.getOrCreateWallet(userId);

    // Recalcular balance para asegurar consistencia
    const recalculated = await this.recalculateBalance(userId);

    return {
      walletId: recalculated.walletId,
      balance: recalculated.balance,
      currency: recalculated.currency,
      updatedAt: recalculated.updatedAt,
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
    const updatedWallet = await transaction.collectorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          increment: new Prisma.Decimal(amount),
        },
      },
    });

    // Verificar que el balance se actualizó correctamente
    const actualBalanceAfter = Number(updatedWallet.balance);
    if (Math.abs(actualBalanceAfter - balanceAfter) > 0.01) {
      this.logger.error(
        `Error: Balance no coincide después del increment. Esperado: ${balanceAfter}, Obtenido: ${actualBalanceAfter}`,
      );
      // Usar el balance real obtenido de la actualización
      const correctedBalanceAfter = actualBalanceAfter;
      
      // Registrar transacción con el balance corregido
      await transaction.collectorWalletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: CollectorWalletTransactionType.COLLECTION,
          amount: new Prisma.Decimal(amount),
          currency: wallet.currency,
          description,
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(correctedBalanceAfter),
          subLoanId,
        },
      });
    } else {
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
    }

    this.logger.log(
      `Cobro registrado: Usuario ${userId}, Monto ${amount}, Nuevo balance ${balanceAfter}`,
    );
  }

  /**
   * Realizar un retiro de la wallet de cobrador
   * PERMITE SALDO NEGATIVO - La wallet puede tener saldo negativo
   * El dinero retirado se deposita automáticamente en la caja fuerte
   */
  async withdraw(
    userId: string,
    amount: number,
    description: string,
  ): Promise<any> {
    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Usar transacción atómica para el retiro y depósito en caja fuerte
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
        const balanceBefore = currentBalance;
        const balanceAfter = currentBalance - amount;

        // Actualizar balance usando decrement para atomicidad
        // PERMITE SALDO NEGATIVO
        const updatedWallet = await tx.collectorWallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              decrement: new Prisma.Decimal(amount),
            },
          },
        });

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

        // Depositar en la caja fuerte
        let safe = await tx.safe.findUnique({
          where: { userId },
        });

        if (!safe) {
          safe = await tx.safe.create({
            data: {
              userId,
              balance: new Prisma.Decimal(0),
              currency: wallet.currency,
            },
          });
        }

        const safeBalanceBefore = Number(safe.balance);
        const updatedSafe = await tx.safe.update({
          where: { id: safe.id },
          data: {
            balance: {
              increment: new Prisma.Decimal(amount),
            },
          },
        });

        const safeBalanceAfter = Number(updatedSafe.balance);

        // Crear transacción en la caja fuerte
        await tx.safeTransaction.create({
          data: {
            safeId: safe.id,
            userId,
            type: SafeTransactionType.TRANSFER_FROM_COLLECTOR,
            amount: new Prisma.Decimal(amount),
            currency: safe.currency,
            description: `Retiro desde wallet de cobros: ${description}`,
            balanceBefore: new Prisma.Decimal(safeBalanceBefore),
            balanceAfter: new Prisma.Decimal(safeBalanceAfter),
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
   * Retirar dinero de la wallet de cobros de un manager (solo SUBADMIN)
   * PERMITE SALDO NEGATIVO
   */
  async withdrawFromManager(
    subadminId: string,
    managerId: string,
    amount: number,
    description: string,
  ): Promise<any> {
    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Validar que el usuario es SUBADMIN
    const subadmin = await this.prisma.user.findUnique({
      where: { id: subadminId },
    });

    if (!subadmin || subadmin.role !== UserRole.SUBADMIN) {
      throw new ForbiddenException('Solo SUBADMIN puede retirar de wallets de managers');
    }

    // Validar que el manager existe y pertenece al subadmin
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager) {
      throw new NotFoundException('Manager no encontrado');
    }

    if (manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('El usuario debe ser un MANAGER');
    }

    if (manager.createdById !== subadminId) {
      throw new ForbiddenException(
        'Solo puedes retirar de wallets de managers que tú creaste',
      );
    }

    // Usar transacción atómica para el retiro
    const result = await this.prisma.$transaction(
      async (tx) => {
        // 1. Obtener wallets
        const collectorWallet = await tx.collectorWallet.findUnique({
          where: { userId: managerId },
        });

        if (!collectorWallet) {
          throw new NotFoundException('Wallet de cobrador no encontrada');
        }

        const collectorBalanceBefore = Number(collectorWallet.balance);

        // 2. Obtener o crear Safe del manager
        let managerSafe = await tx.safe.findUnique({
          where: { userId: managerId },
        });

        if (!managerSafe) {
          this.logger.log(`Creando caja fuerte para manager ${managerId}`);
          managerSafe = await tx.safe.create({
            data: {
              userId: managerId,
              balance: new Prisma.Decimal(0),
              currency: 'ARS',
            },
          });
        }

        const safeBalanceBefore = Number(managerSafe.balance);

        // 3. Debitar de la collector wallet del manager
        const updatedCollectorWallet = await tx.collectorWallet.update({
          where: { id: collectorWallet.id },
          data: {
            balance: {
              decrement: new Prisma.Decimal(amount),
            },
          },
        });

        const collectorBalanceAfter = Number(updatedCollectorWallet.balance);

        // 4. Acreditar a la Safe del manager (depósito)
        const updatedManagerSafe = await tx.safe.update({
          where: { id: managerSafe.id },
          data: {
            balance: {
              increment: new Prisma.Decimal(amount),
            },
          },
        });

        const safeBalanceAfter = Number(updatedManagerSafe.balance);

        // 5. Registrar transacción de retiro en la collector wallet
        const collectorTransaction = await tx.collectorWalletTransaction.create({
          data: {
            walletId: collectorWallet.id,
            userId: managerId, // El manager es el dueño de la wallet
            type: CollectorWalletTransactionType.WITHDRAWAL,
            amount: new Prisma.Decimal(amount),
            currency: collectorWallet.currency,
            description: `Retiro por SUBADMIN: ${description}`,
            balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
            balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
          },
        });

        // 6. Registrar transacción de depósito en la Safe del manager
        const safeTransaction = await tx.safeTransaction.create({
          data: {
            safeId: managerSafe.id,
            userId: managerId,
            type: SafeTransactionType.TRANSFER_FROM_COLLECTOR,
            amount: new Prisma.Decimal(amount),
            currency: managerSafe.currency,
            description: `Retiro de wallet de cobros: ${description}`,
            balanceBefore: new Prisma.Decimal(safeBalanceBefore),
            balanceAfter: new Prisma.Decimal(safeBalanceAfter),
          },
        });

        this.logger.log(
          `Retiro de manager realizado por SUBADMIN: SUBADMIN ${subadminId} -> MANAGER ${managerId}, Monto ${amount}, Collector balance ${collectorBalanceAfter}, Safe balance ${safeBalanceAfter}`,
        );

        return {
          transaction: collectorTransaction,
          wallet: updatedCollectorWallet,
          safeTransaction: safeTransaction,
          safe: updatedManagerSafe,
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
      safeTransaction: {
        id: result.safeTransaction.id,
        type: result.safeTransaction.type,
        amount: Number(result.safeTransaction.amount),
        balanceBefore: Number(result.safeTransaction.balanceBefore),
        balanceAfter: Number(result.safeTransaction.balanceAfter),
        description: result.safeTransaction.description,
        createdAt: result.safeTransaction.createdAt,
      },
      manager: {
        id: managerId,
        email: manager.email,
        fullName: manager.fullName,
      },
    };
  }

  /**
   * Registrar un gasto de ruta en la wallet (uso interno)
   * PERMITE SALDO NEGATIVO
   */
  async recordRouteExpense(params: {
    userId: string;
    amount: number;
    description: string;
    routeId: string;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    const { userId, amount, description, routeId, transaction } = params;

    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Obtener o crear wallet
    const wallet = await this.getOrCreateWallet(userId, transaction);
    const balanceBefore = Number(wallet.balance);

    // Actualizar balance usando decrement para atomicidad
    // PERMITE SALDO NEGATIVO
    const updatedWallet = await transaction.collectorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: new Prisma.Decimal(amount),
        },
      },
    });

    // Obtener el balance real después de la actualización
    const balanceAfter = Number(updatedWallet.balance);

    // Registrar transacción de gasto de ruta
    await transaction.collectorWalletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type: CollectorWalletTransactionType.ROUTE_EXPENSE,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
      },
    });

    this.logger.log(
      `Gasto de ruta registrado: Usuario ${userId}, Monto ${amount}, Nuevo balance ${balanceAfter}`,
    );
  }

  /**
   * Registrar un desembolso de préstamo en la wallet (uso interno)
   * PERMITE SALDO NEGATIVO
   */
  async recordLoanDisbursement(params: {
    userId: string;
    amount: number;
    description: string;
    loanId: string;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    const { userId, amount, description, loanId, transaction } = params;

    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Obtener o crear wallet
    const wallet = await this.getOrCreateWallet(userId, transaction);
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore - amount;

    // Actualizar balance usando decrement para atomicidad
    // PERMITE SALDO NEGATIVO
    await transaction.collectorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: new Prisma.Decimal(amount),
        },
      },
    });

    // Registrar transacción de desembolso de préstamo
    await transaction.collectorWalletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type: CollectorWalletTransactionType.LOAN_DISBURSEMENT,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
      },
    });

    this.logger.log(
      `Desembolso de préstamo registrado: Usuario ${userId}, Monto ${amount}, Nuevo balance ${balanceAfter}`,
    );
  }

  /**
   * Ajuste de caja: Ingresar dinero a la wallet de cobros desde la wallet del subadmin
   * Solo SUBADMIN puede realizar esta operación
   * Se usa para cuadreo de caja negativo
   */
  async cashAdjustment(
    subadminId: string,
    managerId: string,
    amount: number,
    description: string,
  ): Promise<any> {
    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Validar que el usuario es SUBADMIN
    const subadmin = await this.prisma.user.findUnique({
      where: { id: subadminId },
    });

    if (!subadmin || subadmin.role !== UserRole.SUBADMIN) {
      throw new ForbiddenException('Solo SUBADMIN puede realizar ajustes de caja');
    }

    // Validar que el manager existe y pertenece al subadmin
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager) {
      throw new NotFoundException('Manager no encontrado');
    }

    if (manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('El usuario debe ser un MANAGER');
    }

    if (manager.createdById !== subadminId) {
      throw new ForbiddenException(
        'Solo puedes hacer ajustes de caja a managers que tú creaste',
      );
    }

    // Realizar ajuste en transacción atómica
    // El ajuste de caja debita de la Safe del manager y acredita a su collector wallet
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Obtener o crear Safe del manager
      let safe = await tx.safe.findUnique({
        where: { userId: managerId },
      });

      if (!safe) {
        safe = await tx.safe.create({
          data: {
            userId: managerId,
            balance: new Prisma.Decimal(0),
            currency: 'ARS',
          },
        });
      }

      // 2. Obtener o crear collector wallet del manager
      const managerCollectorWallet = await this.getOrCreateWallet(managerId, tx);
      
      const safeBalanceBefore = Number(safe.balance);
      const collectorBalanceBefore = Number(managerCollectorWallet.balance);

      // 3. Debitar de la Safe del manager (permite saldo negativo)
      const updatedSafe = await tx.safe.update({
        where: { id: safe.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });

      const safeBalanceAfter = Number(updatedSafe.balance);

      // 4. Acreditar a la collector wallet del manager
      const updatedCollectorWallet = await tx.collectorWallet.update({
        where: { id: managerCollectorWallet.id },
        data: {
          balance: {
            increment: new Prisma.Decimal(amount),
          },
        },
      });

      const collectorBalanceAfter = Number(updatedCollectorWallet.balance);

      // 5. Crear transacción en la Safe del manager
      const safeTransaction = await tx.safeTransaction.create({
        data: {
          safeId: safe.id,
          userId: managerId,
          type: SafeTransactionType.TRANSFER_TO_COLLECTOR,
          amount: new Prisma.Decimal(amount),
          currency: safe.currency,
          description: `Ajuste de caja a wallet de cobros: ${description}`,
          balanceBefore: new Prisma.Decimal(safeBalanceBefore),
          balanceAfter: new Prisma.Decimal(safeBalanceAfter),
        },
      });

      // 6. Registrar transacción en la collector wallet del manager
      const collectorTransaction = await tx.collectorWalletTransaction.create({
        data: {
          walletId: managerCollectorWallet.id,
          userId: managerId,
          type: CollectorWalletTransactionType.CASH_ADJUSTMENT,
          amount: new Prisma.Decimal(amount),
          currency: managerCollectorWallet.currency,
          description: `Ajuste de caja desde caja fuerte: ${description}`,
          balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
          balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
        },
      });

      this.logger.log(
        `Ajuste de caja realizado: SUBADMIN ${subadminId} -> MANAGER ${managerId}, Monto ${amount}, Safe balance ${safeBalanceAfter}, Collector balance ${collectorBalanceAfter}`,
      );

      return {
        safe: updatedSafe,
        collectorWallet: updatedCollectorWallet,
        safeTransaction,
        collectorTransaction,
        safeBalanceBefore,
        collectorBalanceBefore,
      };
    });

    return {
      safe: {
        balanceBefore: result.safeBalanceBefore,
        balanceAfter: Number(result.safe.balance),
        newBalance: Number(result.safe.balance),
      },
      collectorWallet: {
        balanceBefore: result.collectorBalanceBefore,
        balanceAfter: Number(result.collectorWallet.balance),
        newBalance: Number(result.collectorWallet.balance),
      },
      safeTransaction: {
        id: result.safeTransaction.id,
        type: result.safeTransaction.type,
        amount: Number(result.safeTransaction.amount),
        description: result.safeTransaction.description,
        balanceBefore: Number(result.safeTransaction.balanceBefore),
        balanceAfter: Number(result.safeTransaction.balanceAfter),
        createdAt: result.safeTransaction.createdAt,
      },
      collectorTransaction: {
        id: result.collectorTransaction.id,
        type: result.collectorTransaction.type,
        amount: Number(result.collectorTransaction.amount),
        description: result.collectorTransaction.description,
        balanceBefore: Number(result.collectorTransaction.balanceBefore),
        balanceAfter: Number(result.collectorTransaction.balanceAfter),
        createdAt: result.collectorTransaction.createdAt,
      },
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
      // Usar DateUtil para manejar correctamente la zona horaria de Buenos Aires
      const startDt = DateUtil.fromJSDate(startDate).startOf('day');
      periodStart = DateUtil.toJSDate(startDt);
      
      const endDt = DateUtil.fromJSDate(endDate).endOf('day');
      periodEnd = DateUtil.toJSDate(endDt);
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

    // 2. Suma de cobros, retiros, préstamos y ajustes de caja del período
    const totalCollections = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.COLLECTION)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalWithdrawals = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.WITHDRAWAL)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalLoanedFromTransactions = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalCashAdjustments = collectorWalletTransactions
      .filter((t) => t.type === CollectorWalletTransactionType.CASH_ADJUSTMENT)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const netCollectorWallet = totalCollections - totalWithdrawals - totalLoanedFromTransactions + totalCashAdjustments;

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

    // 7. Obtener préstamos creados en el período
    const loansCreated = await this.prisma.loan.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
        client: {
          managers: {
            some: {
              userId: targetUserId,
              deletedAt: null,
            },
          },
        },
        deletedAt: null,
      },
      select: {
        id: true,
        amount: true,
        loanTrack: true,
        createdAt: true,
      },
    });

    const totalLoaned = loansCreated.reduce(
      (sum, loan) => sum + Number(loan.amount),
      0,
    );

    // 8. Calcular comisión automática (solo en base a lo cobrado)
    // Nota: totalWithdrawals ya fue calculado anteriormente
    const commissionPercentage = user?.commission ? Number(user.commission) : 0;
    const commissionAmount = (totalAmountCollected * commissionPercentage) / 100;

    // 9. Calcular neto: cobrado - gastado - prestado - retirado + ajustes de caja
    // Usar totalLoanedFromTransactions (de transacciones) en lugar de totalLoaned (de préstamos creados)
    // para mantener consistencia con el balance de la wallet
    const neto = totalAmountCollected - totalExpenses - totalLoanedFromTransactions - totalWithdrawals + totalCashAdjustments;

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
      cobrado: totalAmountCollected, // Pagos de préstamos en el rango
      gastado: totalExpenses, // Gastos de rutas en el rango
      prestado: totalLoanedFromTransactions, // Monto prestado (desde transacciones de collector wallet)
      retirado: totalWithdrawals, // Retiros de la wallet de cobros del manager
      ajusteCaja: totalCashAdjustments, // Ajustes de caja (cuadreo de caja negativo)
      neto: Number(neto.toFixed(2)), // cobrado - gastado - prestado - retirado + ajusteCaja
      commission: {
        percentage: commissionPercentage,
        baseAmount: totalAmountCollected, // Base solo en lo cobrado
        commissionAmount: Number(commissionAmount.toFixed(2)),
      },
      // Datos adicionales para compatibilidad
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
        totalLoaned: totalLoanedFromTransactions,
        totalCashAdjustments,
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
      loans: {
        total: loansCreated.length,
        totalAmount: totalLoaned,
        loans: loansCreated.map((loan) => ({
          id: loan.id,
          loanTrack: loan.loanTrack,
          amount: Number(loan.amount),
          createdAt: loan.createdAt,
        })),
      },
      summary: {
        cobrado: totalAmountCollected,
        gastado: totalExpenses,
        prestado: totalLoanedFromTransactions,
        retirado: totalWithdrawals,
        ajusteCaja: totalCashAdjustments,
        neto: Number(neto.toFixed(2)),
        commission: Number(commissionAmount.toFixed(2)),
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
        originalAmount: true,
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
      (sum, loan) => sum + Number(loan.originalAmount),
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

  async getTodayCollections(userId: string, userRole: UserRole) {
    // Obtener la fecha de hoy (inicio y fin del día)
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Construir whereClause basado en el rol del usuario
    const whereClause: any = {
      type: CollectorWalletTransactionType.COLLECTION,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      // MANAGER: solo sus cobros
      whereClause.userId = userId;
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: cobros de sus managers
      const managedUsers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });
      const managedUserIds = managedUsers.map((u) => u.id);
      whereClause.userId = { in: managedUserIds };
    }
    // ADMIN y SUPERADMIN ven todos los cobros

    const collections = await this.prisma.collectorWalletTransaction.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transformar los datos para devolver el formato requerido
    const transformedCollections = collections.map((collection) => ({
      monto: Number(collection.amount),
      nombreUsuario: collection.user.fullName,
      emailUsuario: collection.user.email,
      descripcion: collection.description,
      fechaCobro: collection.createdAt,
    }));

    // Calcular totales
    const total = transformedCollections.length;
    const totalAmount = transformedCollections.reduce(
      (sum, collection) => sum + collection.monto,
      0,
    );

    // Formatear fecha para la respuesta
    const date = today.toISOString().split('T')[0]; // YYYY-MM-DD

    return {
      date,
      total,
      totalAmount,
      collections: transformedCollections,
    };
  }

  async getAllWalletHistory(userId: string, userRole: UserRole): Promise<any> {
    // Construir whereClause basado en el rol del usuario
    const whereClause: any = {};
    let managerIds: string[] = [];

    // Filtros de acceso por rol
    if (userRole === UserRole.MANAGER) {
      // MANAGER: solo sus transacciones
      const wallet = await this.getOrCreateWallet(userId);
      whereClause.walletId = wallet.id;
      managerIds = [userId];
    } else if (userRole === UserRole.SUBADMIN) {
      // SUBADMIN: transacciones de sus managers
      const managedUsers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });
      const managedUserIds = managedUsers.map((u) => u.id);
      managerIds = managedUserIds;
      
      // Obtener wallets de los managers
      const wallets = await this.prisma.collectorWallet.findMany({
        where: {
          userId: { in: managedUserIds },
        },
        select: { id: true },
      });
      const walletIds = wallets.map((w) => w.id);
      whereClause.walletId = { in: walletIds };
    }
    // ADMIN y SUPERADMIN ven todas las transacciones

    // Obtener transacciones de wallet
    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    // Obtener gastos de rutas según el rol
    const routeExpenseWhere: any = {};
    if (userRole === UserRole.MANAGER) {
      routeExpenseWhere.route = {
        managerId: userId,
      };
    } else if (userRole === UserRole.SUBADMIN) {
      if (managerIds.length > 0) {
        routeExpenseWhere.route = {
          managerId: { in: managerIds },
        };
      } else {
        // Si no hay managers, no hay gastos que mostrar
        routeExpenseWhere.route = {
          managerId: { in: [] },
        };
      }
    }
    // ADMIN y SUPERADMIN ven todos los gastos (routeExpenseWhere queda vacío)

    const routeExpenses = await this.prisma.routeExpense.findMany({
      where: routeExpenseWhere,
      include: {
        route: {
          select: {
            id: true,
            managerId: true,
            routeDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transformar transacciones de wallet
    const walletTransactions = transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      currency: t.currency,
      description: t.description,
      balanceBefore: Number(t.balanceBefore),
      balanceAfter: Number(t.balanceAfter),
      subLoanId: t.subLoanId,
      createdAt: t.createdAt,
    }));

    // Transformar gastos de ruta
    const expenseTransactions = routeExpenses.map((expense) => ({
      id: expense.id,
      type: CollectorWalletTransactionType.ROUTE_EXPENSE,
      amount: Number(expense.amount),
      currency: 'ARS',
      description: `Gasto de ruta: ${expense.description}`,
      balanceBefore: 0, // Los gastos no afectan el balance directamente
      balanceAfter: 0,
      routeExpenseId: expense.id,
      routeId: expense.route.id,
      expenseCategory: expense.category,
      createdAt: expense.createdAt,
    }));

    // Combinar y ordenar por fecha descendente
    const allTransactions = [...walletTransactions, ...expenseTransactions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      total: allTransactions.length,
      transactions: allTransactions,
    };
  }

  /**
   * Obtener historial completo paginado de todos los movimientos financieros de la wallet
   * Incluye: cobros, retiros, gastos de ruta, préstamos y ajustes de caja
   * Ordenado por fecha descendente (más recientes primero)
   */
  async getCompleteHistory(
    managerId: string,
    page: number = 1,
    limit: number = 50,
    filters?: {
      type?: CollectorWalletTransactionType;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<any> {
    const wallet = await this.getOrCreateWallet(managerId);

    const skip = (page - 1) * limit;

    // Construir where clause con filtros
    const whereClause: any = {
      walletId: wallet.id,
    };

    // Filtro por tipo
    if (filters?.type) {
      whereClause.type = filters.type;
    }

    // Filtros por fecha
    if (filters?.startDate || filters?.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        const startDt = DateUtil.fromISO(filters.startDate).startOf('day');
        whereClause.createdAt.gte = DateUtil.toJSDate(startDt);
      }
      if (filters.endDate) {
        const endDt = DateUtil.fromISO(filters.endDate).endOf('day');
        whereClause.createdAt.lte = DateUtil.toJSDate(endDt);
      }
    }

    // Obtener transacciones paginadas
    const [transactions, total] = await Promise.all([
      this.prisma.collectorWalletTransaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.collectorWalletTransaction.count({
        where: whereClause,
      }),
    ]);

    // Recalcular el balance actual basándose en todas las transacciones (no solo las filtradas)
    // Esto asegura que el balance sea correcto incluso si hay filtros aplicados
    const recalculatedBalance = await this.recalculateBalance(managerId);
    const currentBalance = recalculatedBalance.balance;

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
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
      wallet: {
        id: wallet.id,
        balance: currentBalance,
        currency: wallet.currency,
      },
    };
  }

  /**
   * Obtener balances de wallets de cobros de todos los managers
   * Para SUBADMIN: solo sus managers
   * Para ADMIN/SUPERADMIN: todos los managers
   */
  async getManagersBalances(userId: string, userRole: UserRole): Promise<any> {
    let managerIds: string[] = [];

    if (userRole === UserRole.SUBADMIN) {
      // Obtener managers creados por este SUBADMIN
      const managedUsers = await this.prisma.user.findMany({
        where: {
          createdById: userId,
          role: UserRole.MANAGER,
          deletedAt: null,
        },
        select: { id: true },
      });
      managerIds = managedUsers.map((u) => u.id);
    } else if (userRole === UserRole.ADMIN || userRole === UserRole.SUPERADMIN) {
      // Obtener todos los managers
      const allManagers = await this.prisma.user.findMany({
        where: {
          role: UserRole.MANAGER,
          deletedAt: null,
        },
        select: { id: true },
      });
      managerIds = allManagers.map((m) => m.id);
    }

    if (managerIds.length === 0) {
      return {
        total: 0,
        totalBalance: 0,
        managers: [],
      };
    }

    // Obtener información de los managers con sus wallets de cobros
    const managers = await this.prisma.user.findMany({
      where: {
        id: { in: managerIds },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        collectorWallet: {
          select: {
            id: true,
            balance: true,
            currency: true,
          },
        },
      },
    });

    // Recalcular balances para cada manager
    const managersWithBalances = await Promise.all(
      managers.map(async (manager) => {
        let balance = 0;
        
        if (manager.collectorWallet) {
          // Recalcular balance desde transacciones
          const transactions = await this.prisma.collectorWalletTransaction.findMany({
            where: { walletId: manager.collectorWallet.id },
            orderBy: { createdAt: 'asc' },
          });

          let calculatedBalance = 0;
          for (const transaction of transactions) {
            if (
              transaction.type === CollectorWalletTransactionType.COLLECTION ||
              transaction.type === CollectorWalletTransactionType.CASH_ADJUSTMENT ||
              transaction.type === CollectorWalletTransactionType.PAYMENT_RESET
            ) {
              // COLLECTION y CASH_ADJUSTMENT tienen amount positivo, PAYMENT_RESET tiene amount negativo
              // Al sumar directamente, PAYMENT_RESET resta correctamente
              calculatedBalance += Number(transaction.amount);
            } else if (
              transaction.type === CollectorWalletTransactionType.WITHDRAWAL ||
              transaction.type === CollectorWalletTransactionType.ROUTE_EXPENSE ||
              transaction.type === CollectorWalletTransactionType.LOAN_DISBURSEMENT
            ) {
              calculatedBalance -= Number(transaction.amount);
            }
          }

          balance = calculatedBalance;

          // Si hay discrepancia, actualizar el balance almacenado
          const storedBalance = Number(manager.collectorWallet.balance);
          if (Math.abs(calculatedBalance - storedBalance) > 0.01) {
            await this.prisma.collectorWallet.update({
              where: { id: manager.collectorWallet.id },
              data: {
                balance: calculatedBalance,
              },
            });
          }
        }

        return {
          managerId: manager.id,
          email: manager.email,
          fullName: manager.fullName,
          collectorWallet: {
            id: manager.collectorWallet?.id || null,
            balance: balance,
            currency: manager.collectorWallet?.currency || 'ARS',
          },
        };
      }),
    );

    const totalBalance = managersWithBalances.reduce(
      (sum, m) => sum + m.collectorWallet.balance,
      0,
    );

    return {
      total: managersWithBalances.length,
      totalBalance,
      managers: managersWithBalances,
    };
  }

  /**
   * Obtener información detallada del manager incluyendo préstamos y cuotas
   * Incluye: nombre, email, cuota de clientes, clientes actuales, dinero en calle, y todos los préstamos con sus subpréstamos
   */
  async getManagerDetail(managerId: string): Promise<any> {
    // 1. Obtener información del manager
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        clientQuota: true,
        usedClientQuota: true,
      },
    });

    if (!manager) {
      throw new NotFoundException('Manager no encontrado');
    }

    if (manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('El usuario debe ser un MANAGER');
    }

    // 2. Obtener todos los préstamos del manager con sus subpréstamos y cliente
    const loans = await this.prisma.loan.findMany({
      where: {
        managerId: managerId,
        deletedAt: null,
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            phone: true,
            email: true,
            address: true,
          },
        },
        subLoans: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            paymentNumber: 'asc',
          },
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
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 3. Calcular "dinero en calle" = suma del monto pendiente de subloans no completamente pagados
    // Considera pagos parciales: dineroEnCalle = totalAmount - paidAmount para cada subloan no pagado
    let dineroEnCalle = 0;
    for (const loan of loans) {
      for (const subLoan of loan.subLoans) {
        // Solo contar subloans que no están completamente pagados
        if (subLoan.status !== 'PAID') {
          // Calcular monto pendiente: totalAmount - paidAmount
          const totalAmount = Number(subLoan.totalAmount);
          const paidAmount = Number(subLoan.paidAmount);
          const pendingAmount = totalAmount - paidAmount;
          dineroEnCalle += pendingAmount;
        }
      }
    }

    // 4. Formatear respuesta
    return {
      manager: {
        id: manager.id,
        fullName: manager.fullName,
        email: manager.email,
        clientQuota: manager.clientQuota,
        usedClientQuota: manager.usedClientQuota,
        availableClientQuota: manager.clientQuota - manager.usedClientQuota,
      },
      dineroEnCalle: Number(dineroEnCalle.toFixed(2)),
      totalLoans: loans.length,
      loans: loans.map((loan) => ({
        id: loan.id,
        loanTrack: loan.loanTrack,
        amount: Number(loan.amount),
        originalAmount: Number(loan.originalAmount),
        currency: loan.currency,
        status: loan.status,
        baseInterestRate: Number(loan.baseInterestRate),
        penaltyInterestRate: Number(loan.penaltyInterestRate),
        paymentFrequency: loan.paymentFrequency,
        totalPayments: loan.totalPayments,
        description: loan.description,
        createdAt: loan.createdAt,
        client: {
          id: loan.client.id,
          fullName: loan.client.fullName,
          dni: loan.client.dni,
          phone: loan.client.phone,
          email: loan.client.email,
          address: loan.client.address,
        },
        subLoans: loan.subLoans.map((subLoan) => ({
          id: subLoan.id,
          paymentNumber: subLoan.paymentNumber,
          amount: Number(subLoan.amount),
          totalAmount: Number(subLoan.totalAmount),
          status: subLoan.status,
          dueDate: subLoan.dueDate,
          paidDate: subLoan.paidDate,
          paidAmount: Number(subLoan.paidAmount),
          daysOverdue: subLoan.daysOverdue,
          createdAt: subLoan.createdAt,
          // Calcular monto pendiente
          pendingAmount: Number(subLoan.totalAmount) - Number(subLoan.paidAmount),
          // Indicar si está completamente pagado
          isFullyPaid: subLoan.status === 'PAID',
        })),
        // Estadísticas del préstamo
        stats: {
          totalSubLoans: loan.subLoans.length,
          paidSubLoans: loan.subLoans.filter((sl) => sl.status === 'PAID').length,
          pendingSubLoans: loan.subLoans.filter((sl) => sl.status === 'PENDING').length,
          overdueSubLoans: loan.subLoans.filter((sl) => sl.status === 'OVERDUE').length,
          partialSubLoans: loan.subLoans.filter((sl) => sl.status === 'PARTIAL').length,
          totalPaid: loan.subLoans.reduce((sum, sl) => sum + Number(sl.paidAmount), 0),
          totalPending: loan.subLoans.reduce(
            (sum, sl) => sum + (sl.status !== 'PAID' ? Number(sl.totalAmount) - Number(sl.paidAmount) : 0),
            0,
          ),
        },
      })),
    };
  }

  /**
   * Obtener sumatoria de cobros realizados a subpréstamos en un rango de fechas
   * Solo cuenta transacciones de tipo COLLECTION
   */
  async getCollectionsSummary(
    managerId: string,
    startDateStr: string,
    endDateStr: string,
  ): Promise<any> {
    // Validar que el manager existe
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, role: true },
    });

    if (!manager) {
      throw new NotFoundException('Manager no encontrado');
    }

    if (manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('El usuario debe ser un MANAGER');
    }

    // Parsear fechas desde formato DD/MM/YYYY
    // Ejemplo: "19/11/2025" -> DateTime en zona horaria de Buenos Aires
    const parseDate = (dateStr: string): DateTime => {
      const [day, month, year] = dateStr.split('/').map(Number);
      return DateTime.fromObject(
        { year, month, day },
        { zone: DateUtil.BUENOS_AIRES_TIMEZONE },
      );
    };

    const startDate = parseDate(startDateStr).startOf('day');
    const endDate = parseDate(endDateStr).endOf('day');

    // Validar que startDate <= endDate
    if (startDate > endDate) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior o igual a la fecha de fin',
      );
    }

    // Obtener wallet del manager
    const wallet = await this.getOrCreateWallet(managerId);
    if (!wallet) {
      throw new NotFoundException('Wallet de cobros no encontrada');
    }

    // Buscar transacciones de tipo COLLECTION en el rango de fechas
    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: CollectorWalletTransactionType.COLLECTION,
        createdAt: {
          gte: startDate.toJSDate(),
          lte: endDate.toJSDate(),
        },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        description: true,
        createdAt: true,
      },
    });

    // Sumar todos los amounts
    const totalAmount = transactions.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );

    return {
      managerId: managerId,
      startDate: startDate.toFormat('dd/MM/yyyy'),
      endDate: endDate.toFormat('dd/MM/yyyy'),
      totalAmount: Number(totalAmount.toFixed(2)),
      currency: transactions.length > 0 ? transactions[0].currency : 'ARS',
      totalCollections: transactions.length,
    };
  }
}

