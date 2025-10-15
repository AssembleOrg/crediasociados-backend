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
import { PaginationDto } from '../common/dto/pagination.dto';
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

      // Crear registro de transacción
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: walletId,
          userId,
          type: WalletTransactionType.DEPOSIT,
          amount: new Prisma.Decimal(depositDto.amount),
          currency: depositDto.currency,
          description: depositDto.description,
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

      // Crear registro de transacción
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: WalletTransactionType.WITHDRAWAL,
          amount: new Prisma.Decimal(withdrawalDto.amount),
          currency: withdrawalDto.currency,
          description: withdrawalDto.description,
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

    // Validar saldo suficiente
    if (Number(subadminWallet.balance) < transferDto.amount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponible: ${Number(subadminWallet.balance)}, Requerido: ${transferDto.amount}`,
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

    // Realizar transferencia en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Debitar de SUBADMIN
      const updatedSubadminWallet = await tx.wallet.update({
        where: { id: subadminWallet.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(transferDto.amount),
          },
        },
      });

      // Acreditar a MANAGER
      const updatedManagerWallet = await tx.wallet.update({
        where: { id: managerWalletId },
        data: {
          balance: {
            increment: new Prisma.Decimal(transferDto.amount),
          },
        },
      });

      // Crear transacción de SUBADMIN (débito)
      const subadminTransaction = await tx.walletTransaction.create({
        data: {
          walletId: subadminWallet.id,
          userId: subadminId,
          type: WalletTransactionType.TRANSFER_TO_MANAGER,
          amount: new Prisma.Decimal(transferDto.amount),
          currency: transferDto.currency,
          description: transferDto.description,
          relatedUserId: transferDto.managerId,
        },
      });

      // Crear transacción de MANAGER (crédito)
      const managerTransaction = await tx.walletTransaction.create({
        data: {
          walletId: managerWalletId,
          userId: transferDto.managerId,
          type: WalletTransactionType.TRANSFER_FROM_SUBADMIN,
          amount: new Prisma.Decimal(transferDto.amount),
          currency: transferDto.currency,
          description: transferDto.description,
          relatedUserId: subadminId,
        },
      });

      return {
        subadminWallet: updatedSubadminWallet,
        managerWallet: updatedManagerWallet,
        subadminTransaction,
        managerTransaction,
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
        id: result.subadminTransaction.id,
        type: result.subadminTransaction.type,
        amount: Number(result.subadminTransaction.amount),
        createdAt: result.subadminTransaction.createdAt,
      },
    };
  }

  /**
   * Obtener historial de transacciones
   */
  async getTransactions(
    userId: string,
    paginationDto: PaginationDto,
    filters?: {
      type?: WalletTransactionType;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    // Obtener cartera
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Cartera no encontrada');
    }

    // Construir filtros
    const whereClause: any = {
      walletId: wallet.id,
    };

    if (filters?.type) {
      whereClause.type = filters.type;
    }

    if (filters?.startDate || filters?.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = DateUtil.parseToDate(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = DateUtil.parseToDate(filters.endDate);
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
            },
          },
        },
      }),
      this.prisma.walletTransaction.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: transactions.map((t) => ({
        ...t,
        amount: Number(t.amount),
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

    // Validar saldo
    if (Number(wallet.balance) < amount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponible: ${Number(wallet.balance)}, Requerido: ${amount}`,
      );
    }

    // Actualizar balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: new Prisma.Decimal(amount),
        },
      },
    });

    // Crear transacción
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
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

    // Actualizar balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          increment: new Prisma.Decimal(amount),
        },
      },
    });

    // Crear transacción
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: new Prisma.Decimal(amount),
        currency: wallet.currency,
        description,
      },
    });
  }
}
