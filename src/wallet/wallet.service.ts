import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto, WithdrawalDto, TransferDto } from './dto';
import { UserRole, WalletTransactionType, Currency } from '../common/enums';
import { Prisma } from '@prisma/client';
import { DateUtil } from '../common/utils';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crear cartera para un usuario
   */
  async createWallet(
    userId: string,
    currency: Currency = Currency.ARS,
  ): Promise<any> {
    // Verificar que el usuario existe y es SUBADMIN o MANAGER
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.role !== UserRole.SUBADMIN && user.role !== UserRole.MANAGER) {
      throw new BadRequestException(
        'Solo SUBADMIN y MANAGER pueden tener carteras',
      );
    }

    // Verificar si ya tiene cartera
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (existingWallet) {
      return existingWallet;
    }

    // Crear cartera
    const wallet = await this.prisma.wallet.create({
      data: {
        userId,
        balance: new Prisma.Decimal(0),
        currency,
      },
    });

    return {
      ...wallet,
      balance: Number(wallet.balance),
    };
  }

  /**
   * Obtener cartera del usuario
   */
  async getUserWallet(userId: string): Promise<any> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    return {
      ...wallet,
      balance: Number(wallet.balance),
    };
  }

  /**
   * Realizar depósito
   */
  async deposit(userId: string, depositDto: DepositDto): Promise<any> {
    // Obtener o crear cartera
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      wallet = await this.createWallet(userId, depositDto.currency);
    }

    if (!wallet) {
      throw new BadRequestException('No se pudo crear la cartera');
    }

    // Validar moneda
    if (wallet.currency !== depositDto.currency) {
      throw new BadRequestException(
        `La cartera usa ${wallet.currency}, no se puede depositar en ${depositDto.currency}`,
      );
    }

    const walletId = wallet.id; // Guardar el ID antes de la transacción
    const balanceBefore = Number(wallet.balance);

    // Realizar depósito en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Actualizar balance
      const updatedWallet = await tx.wallet.update({
        where: { id: walletId },
        data: {
          balance: {
            increment: new Prisma.Decimal(depositDto.amount),
          },
        },
      });

      const balanceAfter = Number(updatedWallet.balance);

      // Crear registro de transacción
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: walletId,
          userId,
          type: WalletTransactionType.DEPOSIT,
          amount: new Prisma.Decimal(depositDto.amount),
          currency: depositDto.currency,
          description: depositDto.description,
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    return {
      wallet: {
        ...result.wallet,
        balance: Number(result.wallet.balance),
      },
      transaction: {
        ...result.transaction,
        amount: Number(result.transaction.amount),
      },
    };
  }

  /**
   * Realizar retiro
   */
  async withdrawal(userId: string, withdrawalDto: WithdrawalDto): Promise<any> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    // Validar moneda
    if (wallet.currency !== withdrawalDto.currency) {
      throw new BadRequestException(
        `La cartera usa ${wallet.currency}, no se puede retirar en ${withdrawalDto.currency}`,
      );
    }

    // Validar saldo suficiente
    if (Number(wallet.balance) < withdrawalDto.amount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponible: ${Number(wallet.balance)}, Requerido: ${withdrawalDto.amount}`,
      );
    }

    const balanceBefore = Number(wallet.balance);

    // Realizar retiro en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Actualizar balance
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(withdrawalDto.amount),
          },
        },
      });

      const balanceAfter = Number(updatedWallet.balance);

      // Crear registro de transacción
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: WalletTransactionType.WITHDRAWAL,
          amount: new Prisma.Decimal(withdrawalDto.amount),
          currency: withdrawalDto.currency,
          description: withdrawalDto.description,
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    return {
      wallet: {
        ...result.wallet,
        balance: Number(result.wallet.balance),
      },
      transaction: {
        ...result.transaction,
        amount: Number(result.transaction.amount),
      },
    };
  }

  /**
   * Transferir dinero de SUBADMIN a MANAGER
   */
  async transfer(subadminId: string, transferDto: TransferDto): Promise<any> {
    // Verificar que el usuario es SUBADMIN
    const subadmin = await this.prisma.user.findUnique({
      where: { id: subadminId },
    });

    if (!subadmin || subadmin.role !== UserRole.SUBADMIN) {
      throw new ForbiddenException(
        'Solo SUBADMIN puede realizar transferencias',
      );
    }

    // Verificar que el manager existe y es MANAGER
    const manager = await this.prisma.user.findUnique({
      where: { id: transferDto.managerId },
    });

    if (!manager) {
      throw new NotFoundException('Manager no encontrado');
    }

    if (manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('El destinatario debe ser un MANAGER');
    }

    // Verificar que el manager fue creado por este subadmin
    if (manager.createdById !== subadminId) {
      throw new ForbiddenException(
        'Solo puedes transferir a managers que tú creaste',
      );
    }

    // Obtener carteras
    const subadminWallet = await this.prisma.wallet.findUnique({
      where: { userId: subadminId },
    });

    if (!subadminWallet) {
      throw new NotFoundException('Cartera de SUBADMIN no encontrada');
    }

    // Validar moneda
    if (subadminWallet.currency !== transferDto.currency) {
      throw new BadRequestException(
        `La cartera usa ${subadminWallet.currency}, no se puede transferir en ${transferDto.currency}`,
      );
    }

    // Obtener o crear cartera del manager
    let managerWallet = await this.prisma.wallet.findUnique({
      where: { userId: transferDto.managerId },
    });

    if (!managerWallet) {
      managerWallet = await this.createWallet(
        transferDto.managerId,
        transferDto.currency,
      );
    }

    if (!managerWallet) {
      throw new BadRequestException('No se pudo crear la cartera del manager');
    }

    // Validar que ambas carteras usan la misma moneda
    if (managerWallet.currency !== transferDto.currency) {
      throw new BadRequestException(
        `La cartera del manager usa ${managerWallet.currency}, no se puede recibir en ${transferDto.currency}`,
      );
    }

    const managerWalletId = managerWallet.id; // Guardar el ID antes de la transacción
    const transferAmount = transferDto.amount;
    const subadminBalanceBefore = Number(subadminWallet.balance);
    const managerBalanceBefore = Number(managerWallet.balance);

    // Determinar dirección de la transferencia
    // Positivo: SUBADMIN -> MANAGER (transferencia normal)
    // Negativo: MANAGER -> SUBADMIN (retirar fondos del manager)
    const isPositiveTransfer = transferAmount > 0;
    const absoluteAmount = Math.abs(transferAmount);

    // Se permite saldo negativo en el sistema
    // Las validaciones de saldo se removieron para permitir operaciones con saldo negativo

    // Realizar transferencia en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Actualizar balance de SUBADMIN
      const updatedSubadminWallet = await tx.wallet.update({
        where: { id: subadminWallet.id },
        data: {
          balance: isPositiveTransfer
            ? { decrement: new Prisma.Decimal(absoluteAmount) }
            : { increment: new Prisma.Decimal(absoluteAmount) },
        },
      });

      // Actualizar balance de MANAGER
      const updatedManagerWallet = await tx.wallet.update({
        where: { id: managerWalletId },
        data: {
          balance: isPositiveTransfer
            ? { increment: new Prisma.Decimal(absoluteAmount) }
            : { decrement: new Prisma.Decimal(absoluteAmount) },
        },
      });

      const subadminBalanceAfter = Number(updatedSubadminWallet.balance);

      // Crear una única transacción que registra la transferencia
      // userId: quien inicia la transferencia (siempre el SUBADMIN)
      // relatedUserId: el otro usuario involucrado (el MANAGER)
      // walletId: cartera del SUBADMIN (quien ejecuta la acción)
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: subadminWallet.id,
          userId: subadminId,
          type: isPositiveTransfer
            ? WalletTransactionType.TRANSFER_TO_MANAGER
            : WalletTransactionType.TRANSFER_FROM_SUBADMIN,
          amount: new Prisma.Decimal(absoluteAmount),
          currency: transferDto.currency,
          description: transferDto.description,
          relatedUserId: transferDto.managerId,
          balanceBefore: new Prisma.Decimal(subadminBalanceBefore),
          balanceAfter: new Prisma.Decimal(subadminBalanceAfter),
        },
      });

      return {
        subadminWallet: updatedSubadminWallet,
        managerWallet: updatedManagerWallet,
        transaction,
      };
    });

    return {
      fromWallet: {
        userId: subadminId,
        newBalance: Number(result.subadminWallet.balance),
      },
      toWallet: {
        userId: transferDto.managerId,
        newBalance: Number(result.managerWallet.balance),
      },
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: Number(result.transaction.amount),
        from: subadminId,
        to: transferDto.managerId,
        createdAt: result.transaction.createdAt,
      },
    };
  }

  /**
   * Obtener historial de transacciones
   */
  async getTransactions(
    userId: string,
    pagination: { page?: number; limit?: number },
    filters?: {
      type?: WalletTransactionType;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 50 } = pagination; // Aumentado a 50 para mostrar más transacciones por defecto
    const skip = (page - 1) * limit;

    // Obtener cartera
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    // Construir filtros - incluir transacciones donde el usuario es el origen o el destino
    const whereClause: any = {
      OR: [
        { walletId: wallet.id }, // Transacciones en la cartera del usuario (incluye depósitos, retiros, etc.)
        { relatedUserId: userId }, // Transferencias donde el usuario es el destinatario
      ],
    };

    // Aplicar filtros adicionales
    if (filters?.type) {
      whereClause.type = filters.type;
    }

    if (filters?.startDate || filters?.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        // Usar inicio del día en zona horaria de Buenos Aires
        const startDt = DateUtil.fromISO(filters.startDate).startOf('day');
        whereClause.createdAt.gte = DateUtil.toJSDate(startDt);
      }
      if (filters.endDate) {
        // Usar final del día en zona horaria de Buenos Aires
        const endDt = DateUtil.fromISO(filters.endDate).endOf('day');
        whereClause.createdAt.lte = DateUtil.toJSDate(endDt);
      }
    }

    // Obtener transacciones
    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.walletTransaction.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    // Enriquecer transacciones con información del usuario relacionado
    const enrichedTransactions = await Promise.all(
      transactions.map(async (t) => {
        let relatedUser: any = null;
        if (t.relatedUserId) {
          relatedUser = await this.prisma.user.findUnique({
            where: { id: t.relatedUserId },
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          });
        }

        return {
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          currency: t.currency,
          description: t.description,
          balanceBefore: t.balanceBefore ? Number(t.balanceBefore) : null,
          balanceAfter: t.balanceAfter ? Number(t.balanceAfter) : null,
          createdAt: t.createdAt,
          user: t.user,
          relatedUser,
          // Indicar si el usuario actual es el que recibe la transferencia
          isReceiver: t.relatedUserId === userId,
        };
      }),
    );

    return {
      data: enrichedTransactions,
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
   * Obtener balance disponible
   */
  async getBalance(userId: string): Promise<any> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    return {
      balance: Number(wallet.balance),
      currency: wallet.currency,
      availableForLoan: Number(wallet.balance),
      lockedAmount: 0,
    };
  }

  /**
   * Debitar de cartera (uso interno para préstamos)
   * PERMITE SALDO NEGATIVO - El sistema permite que los managers operen con saldo negativo
   */
  async debit(params: {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    description: string;
    transaction?: any;
  }): Promise<void> {
    const { userId, amount, type, description, transaction } = params;
    const tx = transaction || this.prisma;

    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    // NO SE VALIDA SALDO - Se permite saldo negativo en la wallet principal
    // Los managers pueden operar con saldo negativo

    const balanceBefore = Number(wallet.balance);

    // Actualizar balance
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: new Prisma.Decimal(amount),
        },
      },
    });

    const balanceAfter = Number(updatedWallet.balance);

    // Crear transacción
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
      },
    });
  }

  /**
   * Acreditar a cartera (uso interno para pagos)
   */
  async credit(params: {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    description: string;
    transaction?: any;
  }): Promise<void> {
    const { userId, amount, type, description, transaction } = params;
    const tx = transaction || this.prisma;

    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    const balanceBefore = Number(wallet.balance);

    // Actualizar balance
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          increment: new Prisma.Decimal(amount),
        },
      },
    });

    const balanceAfter = Number(updatedWallet.balance);

    // Crear transacción
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
        balanceBefore: new Prisma.Decimal(balanceBefore),
        balanceAfter: new Prisma.Decimal(balanceAfter),
      },
    });
  }
}
