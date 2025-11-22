import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import {
  ClientFiltersDto,
  LoanFiltersDto,
  ClientChartDataDto,
  LoanChartDataDto,
} from '../common/dto';
import { DateUtil } from '../common/utils';
import { SystemConfigService } from '../system-config/system-config.service';
import { WalletService } from '../wallet/wallet.service';
import * as bcrypt from 'bcryptjs';
import { UserRole, ConfigKey } from '../common/enums';
import {
  convertPrismaUserToResponse,
  convertPrismaUserRole,
} from '../common/utils/type-converters.util';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private systemConfigService: SystemConfigService,
    private walletService: WalletService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    currentUser: any,
  ): Promise<UserResponseDto> {
    // Check role permissions
    this.validateRoleCreation(
      createUserDto.role,
      convertPrismaUserRole(currentUser.role),
    );

    // Validate client quota assignment
    await this.validateClientQuotaAssignment(
      createUserDto.role,
      createUserDto.clientQuota,
      currentUser,
    );

    // No DNI/CUIT validation needed - moved to Client model

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // No DNI/CUIT uniqueness validation needed - moved to Client model

    const hashedPassword = await bcrypt.hash(createUserDto.password, 12);

    // Prepare data with client quota
    let clientQuota = createUserDto.clientQuota || 0;

    // If creating an ADMIN, assign the system's max clients limit
    if (createUserDto.role === UserRole.ADMIN) {
      try {
        clientQuota = await this.systemConfigService.getConfig(
          ConfigKey.ADMIN_MAX_CLIENTS,
        );
      } catch (error) {
        // If config doesn't exist, use default value
        clientQuota = 450;
      }
    }

    const userData: any = {
      email: createUserDto.email,
      password: hashedPassword,
      fullName: createUserDto.fullName,
      phone: createUserDto.phone,
      role: createUserDto.role,
      createdById: currentUser.id,
      clientQuota: clientQuota,
      usedClientQuota: 0,
    };

    // Create user and update parent's used quota in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: userData,
      });

      // Update parent's used quota if applicable
      if (
        (createUserDto.role === UserRole.SUBADMIN ||
          createUserDto.role === UserRole.MANAGER) &&
        createUserDto.clientQuota &&
        createUserDto.clientQuota > 0
      ) {
        await tx.user.update({
          where: { id: currentUser.id },
          data: {
            usedClientQuota: {
              increment: createUserDto.clientQuota,
            },
          },
        });
      }

      return newUser;
    });

    // NUEVO: Crear cartera automáticamente si es SUBADMIN o MANAGER
    if (user.role === UserRole.SUBADMIN || user.role === UserRole.MANAGER) {
      try {
        await this.walletService.createWallet(user.id);
      } catch (error) {
        // Si falla la creación de la cartera, no bloqueamos la creación del usuario
        console.error('Error creating wallet for user:', user.id, error);
      }
    }

    const { password, ...result } = user;
    return convertPrismaUserToResponse(result);
  }

  async findAll(
    paginationDto: PaginationDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          clientQuota: true,
          usedClientQuota: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({
        where: { deletedAt: null },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: users.map(convertPrismaUserToResponse),
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

  async findOne(id: string, currentUser?: any): Promise<UserResponseDto> {
    // Si es MANAGER, solo puede ver su propio perfil
    if (currentUser && currentUser.role === UserRole.MANAGER && currentUser.id !== id) {
      throw new ForbiddenException(
        'Los MANAGER solo pueden acceder a su propio perfil',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        clientQuota: true,
        usedClientQuota: true,
        createdAt: true,
        updatedAt: true,
        wallet: {
          select: {
            id: true,
            balance: true,
            currency: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const response = convertPrismaUserToResponse(user);
    
    // Agregar información de wallet si existe
    if (user.wallet) {
      response.wallet = {
        id: user.wallet.id,
        balance: Number(user.wallet.balance),
        currency: user.wallet.currency,
      };
    }

    return response;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: any,
  ): Promise<UserResponseDto> {
    const existingUser = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        clientQuota: true,
        usedClientQuota: true,
        createdById: true,
      },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // Check if user is trying to update their own role or a higher role
    if (
      updateUserDto.role &&
      !this.canUpdateRole(
        convertPrismaUserRole(existingUser.role),
        updateUserDto.role,
        convertPrismaUserRole(currentUser.role),
      )
    ) {
      throw new ForbiddenException('Cannot update user role');
    }

    // Check unique fields if updating
    if (updateUserDto.email) {
      await this.validateUniqueFieldsUpdate(id, updateUserDto);
    }

    const updateData: any = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 12);
    }

    // Si se está actualizando clientQuota de un MANAGER o SUBADMIN, recalcular usedClientQuota del creador
    const isUpdatingQuota = updateUserDto.clientQuota !== undefined;
    const quotaDifference = isUpdatingQuota
      ? (updateUserDto.clientQuota || 0) - existingUser.clientQuota
      : 0;

    // Usar transacción para actualizar el usuario y su creador si es necesario
    const user = await this.prisma.$transaction(async (tx) => {
      // Actualizar el usuario
      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          clientQuota: true,
          usedClientQuota: true,
          createdAt: true,
          updatedAt: true,
          wallet: {
            select: {
              id: true,
              balance: true,
              currency: true,
            },
          },
        },
      });

      // Si cambió la clientQuota y tiene un creador, actualizar usedClientQuota del creador
      if (isUpdatingQuota && existingUser.createdById) {
        const creator = await tx.user.findUnique({
          where: { id: existingUser.createdById },
          select: { id: true, usedClientQuota: true },
        });

        if (creator) {
          await tx.user.update({
            where: { id: creator.id },
            data: {
              usedClientQuota: creator.usedClientQuota + quotaDifference,
            },
          });
        }
      }

      return updatedUser;
    });

    const response = convertPrismaUserToResponse(user);

    // Agregar información de wallet si existe
    if (user.wallet) {
      response.wallet = {
        id: user.wallet.id,
        balance: Number(user.wallet.balance),
        currency: user.wallet.currency,
      };
    }

    return response;
  }

  async remove(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Recalcula el usedClientQuota de un usuario sumando las clientQuota de todos sus usuarios creados
   */
  async recalculateUserQuota(
    userId: string,
    currentUser: any,
  ): Promise<{ message: string; previousUsedQuota: number; newUsedQuota: number }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        usedClientQuota: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validar permisos: solo puede recalcular su propia cuota o la de sus subordinados
    const currentUserRole = convertPrismaUserRole(currentUser.role);
    if (
      currentUserRole !== UserRole.ADMIN &&
      currentUserRole !== UserRole.SUPERADMIN &&
      currentUser.id !== userId
    ) {
      // Si es SUBADMIN, verificar que el usuario sea suyo
      const targetUser = await this.prisma.user.findFirst({
        where: { id: userId, createdById: currentUser.id, deletedAt: null },
      });

      if (!targetUser) {
        throw new ForbiddenException(
          'No tienes permisos para recalcular la cuota de este usuario',
        );
      }
    }

    // Calcular la suma de clientQuota de todos los usuarios creados por este usuario
    const createdUsers = await this.prisma.user.findMany({
      where: {
        createdById: userId,
        deletedAt: null,
      },
      select: {
        clientQuota: true,
      },
    });

    const newUsedQuota = createdUsers.reduce(
      (sum, createdUser) => sum + createdUser.clientQuota,
      0,
    );

    // Actualizar el usedClientQuota
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        usedClientQuota: newUsedQuota,
      },
    });

    return {
      message: 'Cuota recalculada exitosamente',
      previousUsedQuota: user.usedClientQuota,
      newUsedQuota,
    };
  }

  async getCreatedUsers(userId: string): Promise<UserResponseDto[]> {
    const createdUsers = await this.prisma.user.findMany({
      where: {
        createdById: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        clientQuota: true,
        usedClientQuota: true,
        createdAt: true,
        updatedAt: true,
        wallet: {
          select: {
            id: true,
            balance: true,
            currency: true,
          },
        },
        collectorWallet: {
          select: {
            id: true,
            balance: true,
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Recalcular balances de wallets de cobros para cada manager
    const usersWithRecalculatedBalances = await Promise.all(
      createdUsers.map(async (user) => {
        let collectorWalletBalance = 0;
        
        // Si es MANAGER, recalcular balance de su wallet de cobros
        if (user.role === 'MANAGER' && user.collectorWallet) {
          // Recalcular balance desde transacciones
          const transactions = await this.prisma.collectorWalletTransaction.findMany({
            where: { walletId: user.collectorWallet.id },
            orderBy: { createdAt: 'asc' },
          });

          let calculatedBalance = 0;
          for (const transaction of transactions) {
            if (transaction.type === 'COLLECTION') {
              calculatedBalance += Number(transaction.amount);
            } else if (transaction.type === 'WITHDRAWAL') {
              calculatedBalance -= Number(transaction.amount);
            }
          }

          collectorWalletBalance = calculatedBalance;

          // Si hay discrepancia, actualizar el balance almacenado
          const storedBalance = Number(user.collectorWallet.balance);
          if (Math.abs(calculatedBalance - storedBalance) > 0.01) {
            await this.prisma.collectorWallet.update({
              where: { id: user.collectorWallet.id },
              data: {
                balance: calculatedBalance,
              },
            });
          }
        } else if (user.collectorWallet) {
          collectorWalletBalance = Number(user.collectorWallet.balance);
        }

        const response = convertPrismaUserToResponse(user);
        return {
          ...response,
          clientQuota: user.clientQuota,
          usedClientQuota: user.usedClientQuota,
          availableClientQuota: user.clientQuota - user.usedClientQuota,
          wallet: user.wallet
            ? {
                id: user.wallet.id,
                balance: Number(user.wallet.balance),
                currency: user.wallet.currency,
              }
            : null,
          collectorWallet: user.collectorWallet
            ? {
                id: user.collectorWallet.id,
                balance: collectorWalletBalance,
                currency: user.collectorWallet.currency,
              }
            : null,
        };
      }),
    );

    return usersWithRecalculatedBalances;
  }

  async getUserHierarchy(userId: string): Promise<{
    createdBy: UserResponseDto | null;
    createdUsers: UserResponseDto[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const createdUsers = await this.getCreatedUsers(userId);

    return {
      createdBy: user.createdBy
        ? convertPrismaUserToResponse(user.createdBy)
        : null,
      createdUsers,
    };
  }

  private validateRoleCreation(
    newRole: UserRole,
    currentUserRole: UserRole,
  ): void {
    const roleHierarchy: Record<UserRole, UserRole[]> = {
      [UserRole.SUPERADMIN]: [UserRole.ADMIN],
      [UserRole.ADMIN]: [UserRole.SUBADMIN],
      [UserRole.SUBADMIN]: [UserRole.MANAGER],
      [UserRole.MANAGER]: [],
    };

    const allowedRoles = roleHierarchy[currentUserRole];
    if (!allowedRoles.includes(newRole)) {
      throw new ForbiddenException(`Cannot create user with role ${newRole}`);
    }
  }

  private async validateClientQuotaAssignment(
    newRole: UserRole,
    requestedQuota: number | undefined,
    currentUser: any,
  ): Promise<void> {
    // SUPERADMIN doesn't need quota validation (they can create ADMINs)
    if (currentUser.role === UserRole.SUPERADMIN) {
      return;
    }

    // If creating a SUBADMIN or MANAGER, quota is required
    if (
      (newRole === UserRole.SUBADMIN || newRole === UserRole.MANAGER) &&
      (!requestedQuota || requestedQuota <= 0)
    ) {
      throw new BadRequestException(
        `Client quota is required when creating ${newRole} accounts`,
      );
    }

    // Only validate quota for SUBADMIN and MANAGER roles
    if (newRole !== UserRole.SUBADMIN && newRole !== UserRole.MANAGER) {
      return;
    }

    // Get current user's quota information
    const parentUser = await this.prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        clientQuota: true,
        usedClientQuota: true,
        role: true,
      },
    });

    if (!parentUser) {
      throw new NotFoundException('Current user not found');
    }

    const availableQuota =
      parentUser.clientQuota - parentUser.usedClientQuota;

    // Check if parent has enough quota
    if (requestedQuota && requestedQuota > availableQuota) {
      throw new BadRequestException(
        `Insufficient client quota. Available: ${availableQuota}, Requested: ${requestedQuota}`,
      );
    }

    // For ADMINs creating SUBADMINs, check against system config
    if (currentUser.role === UserRole.ADMIN && newRole === UserRole.SUBADMIN) {
      const maxClientsPerAdmin = await this.systemConfigService.getConfig(
        ConfigKey.ADMIN_MAX_CLIENTS,
      );

      if (requestedQuota && requestedQuota > maxClientsPerAdmin) {
        throw new BadRequestException(
          `Cannot assign more than ${maxClientsPerAdmin} clients to a SUBADMIN`,
        );
      }

      // Check if admin's total quota doesn't exceed the system limit
      if (parentUser.clientQuota > maxClientsPerAdmin) {
        throw new BadRequestException(
          `Admin's total client quota cannot exceed ${maxClientsPerAdmin}`,
        );
      }
    }
  }

  private validateUserFields(userData: any): void {
    if (!userData.dni && !userData.cuit) {
      throw new BadRequestException(
        'Either DNI or CUIT must be provided for MANAGER role',
      );
    }
  }

  private async validateUniqueFieldsUpdate(
    id: string,
    updateData: any,
  ): Promise<void> {
    if (updateData.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: updateData.email, id: { not: id } },
      });
      if (existingEmail) {
        throw new BadRequestException('Email already exists');
      }
    }
  }

  private canUpdateRole(
    currentRole: UserRole,
    newRole: UserRole,
    userRole: UserRole,
  ): boolean {
    // Only allow updating roles within the user's permission scope
    const roleHierarchy: Record<UserRole, UserRole[]> = {
      [UserRole.SUPERADMIN]: [UserRole.ADMIN],
      [UserRole.ADMIN]: [UserRole.SUBADMIN],
      [UserRole.SUBADMIN]: [UserRole.MANAGER],
      [UserRole.MANAGER]: [],
    };

    const allowedRoles = roleHierarchy[userRole];
    return allowedRoles.includes(newRole);
  }

  async getManagerClients(
    managerId: string,
    paginationDto: PaginationDto,
    filters: ClientFiltersDto,
    currentUser: any,
  ): Promise<PaginatedResponse<any>> {
    // Verificar que el manager existe
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, deletedAt: null, role: UserRole.MANAGER },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Verificar permisos
    await this.validateManagerAccess(managerId, currentUser);

    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    // Construir filtros
    const whereClause: any = {
      deletedAt: null,
      managers: {
        some: {
          userId: managerId,
          deletedAt: null,
        },
      },
    };

    if (filters.fullName) {
      whereClause.fullName = {
        contains: filters.fullName,
        mode: 'insensitive',
      };
    }
    if (filters.dni) {
      whereClause.dni = { contains: filters.dni };
    }
    if (filters.cuit) {
      whereClause.cuit = { contains: filters.cuit };
    }
    if (filters.email) {
      whereClause.email = { contains: filters.email, mode: 'insensitive' };
    }
    if (filters.phone) {
      whereClause.phone = { contains: filters.phone };
    }
    if (filters.job) {
      whereClause.job = { contains: filters.job, mode: 'insensitive' };
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

    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where: whereClause,
        include: {
          managers: {
            where: { deletedAt: null },
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
          },
          _count: {
            select: {
              loans: true,
              transactions: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: clients,
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

  async getManagerClientsChart(
    managerId: string,
    filters: ClientFiltersDto,
    currentUser: any,
  ): Promise<ClientChartDataDto[]> {
    // Verificar que el manager existe
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, deletedAt: null, role: UserRole.MANAGER },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Verificar permisos
    await this.validateManagerAccess(managerId, currentUser);

    // Construir filtros (mismo que arriba pero sin paginación)
    const whereClause: any = {
      deletedAt: null,
      managers: {
        some: {
          userId: managerId,
          deletedAt: null,
        },
      },
    };

    if (filters.fullName) {
      whereClause.fullName = {
        contains: filters.fullName,
        mode: 'insensitive',
      };
    }
    if (filters.dni) {
      whereClause.dni = { contains: filters.dni };
    }
    if (filters.cuit) {
      whereClause.cuit = { contains: filters.cuit };
    }
    if (filters.email) {
      whereClause.email = { contains: filters.email, mode: 'insensitive' };
    }
    if (filters.phone) {
      whereClause.phone = { contains: filters.phone };
    }
    if (filters.job) {
      whereClause.job = { contains: filters.job, mode: 'insensitive' };
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

    const clients = await this.prisma.client.findMany({
      where: whereClause,
      select: {
        id: true,
        fullName: true,
        dni: true,
        cuit: true,
        createdAt: true,
        loans: {
          where: { deletedAt: null },
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
            subLoans: {
              where: { deletedAt: null },
              select: {
                paidAmount: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((client) => {
      const totalLoans = client.loans.length;
      const activeLoans = client.loans.filter(
        (loan) => loan.status === 'ACTIVE',
      ).length;
      const totalAmount = client.loans.reduce(
        (sum, loan) => sum + Number(loan.amount),
        0,
      );
      const activeAmount = client.loans
        .filter((loan) => loan.status === 'ACTIVE')
        .reduce((sum, loan) => sum + Number(loan.amount), 0);
      const lastLoanDate =
        client.loans.length > 0
          ? client.loans.sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            )[0].createdAt
          : undefined;

      return {
        id: client.id,
        fullName: client.fullName,
        dni: client.dni ?? undefined,
        cuit: client.cuit ?? undefined,
        totalLoans,
        totalAmount,
        activeLoans,
        activeAmount,
        createdAt: client.createdAt,
        lastLoanDate,
      };
    });
  }

  async getManagerLoans(
    managerId: string,
    paginationDto: PaginationDto,
    filters: LoanFiltersDto,
    currentUser: any,
  ): Promise<PaginatedResponse<any>> {
    // Verificar que el manager existe
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, deletedAt: null, role: UserRole.MANAGER },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Verificar permisos
    await this.validateManagerAccess(managerId, currentUser);

    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    // Construir filtros
    const whereClause: any = {
      deletedAt: null,
      client: {
        managers: {
          some: {
            userId: managerId,
            deletedAt: null,
          },
        },
      },
    };

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

    const totalPages = Math.ceil(total / limit);

    return {
      data: loans,
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

  async getManagerLoansChart(
    managerId: string,
    filters: LoanFiltersDto,
    currentUser: any,
  ): Promise<LoanChartDataDto[]> {
    // Verificar que el manager existe
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, deletedAt: null, role: UserRole.MANAGER },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Verificar permisos
    await this.validateManagerAccess(managerId, currentUser);

    // Construir filtros (mismo que arriba pero sin paginación)
    const whereClause: any = {
      deletedAt: null,
      client: {
        managers: {
          some: {
            userId: managerId,
            deletedAt: null,
          },
        },
      },
    };

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

  private async validateManagerAccess(
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

  async getManagerDashboard(managerId: string): Promise<any> {
    // Verificar que el usuario es MANAGER
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager || manager.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Solo los MANAGER pueden acceder a este endpoint');
    }

    // 1. Capital Disponible: Saldo de la caja fuerte
    const safe = await this.prisma.safe.findUnique({
      where: { userId: managerId },
    });

    const capitalDisponible = safe ? Number(safe.balance) : 0;

    // 2. Capital Asignado: Suma de todas las transferencias recibidas del SUBADMIN
    const transferenciasRecibidas = await this.prisma.walletTransaction.findMany({
      where: {
        relatedUserId: managerId,
        type: {
          in: ['TRANSFER_FROM_SUBADMIN', 'TRANSFER_TO_MANAGER'],
        },
      },
    });

    let capitalAsignado = 0;
    for (const trans of transferenciasRecibidas) {
      // Si el tipo es TRANSFER_FROM_SUBADMIN, es dinero que recibió (+)
      // Si el tipo es TRANSFER_TO_MANAGER pero el relatedUser es el manager, es un retiro (-)
      const isReceiving = trans.type === 'TRANSFER_FROM_SUBADMIN';
      const amount = Number(trans.amount);
      capitalAsignado += isReceiving ? amount : -amount;
    }

    // También contar las transferencias donde el manager es el userId pero con tipo TRANSFER_FROM_SUBADMIN
    const transferenciasComoReceptor = await this.prisma.walletTransaction.findMany({
      where: {
        userId: managerId,
        type: 'TRANSFER_FROM_SUBADMIN',
      },
    });

    for (const trans of transferenciasComoReceptor) {
      capitalAsignado -= Number(trans.amount); // Estas son salidas, ya están contadas arriba
    }

    // Recalcular: solo las que fueron hechas POR el subadmin
    capitalAsignado = 0;
    const allTransfers = await this.prisma.walletTransaction.findMany({
      where: {
        OR: [
          {
            // Transferencias donde el manager es el destinatario
            relatedUserId: managerId,
            type: {
              in: ['TRANSFER_TO_MANAGER', 'TRANSFER_FROM_SUBADMIN'],
            },
          },
        ],
      },
    });

    for (const trans of allTransfers) {
      // Si es TRANSFER_TO_MANAGER con relatedUser = manager, significa que recibió dinero
      if (trans.type === 'TRANSFER_TO_MANAGER' && trans.relatedUserId === managerId) {
        capitalAsignado += Number(trans.amount);
      }
      // Si es TRANSFER_FROM_SUBADMIN con relatedUser = manager, significa que le quitaron dinero (retiro)
      if (trans.type === 'TRANSFER_FROM_SUBADMIN' && trans.relatedUserId === managerId) {
        capitalAsignado -= Number(trans.amount);
      }
    }

    // 3. Recaudado Este Mes: Suma de pagos de subloans en el mes actual
    const now = DateUtil.now();
    const startOfMonth = now.startOf('month').toJSDate();
    const endOfMonth = now.endOf('month').toJSDate();

    // Obtener todos los loans del manager
    const managerLoans = await this.prisma.loan.findMany({
      where: {
        client: {
          managers: {
            some: {
              userId: managerId,
              deletedAt: null,
            },
          },
        },
        deletedAt: null,
      },
      select: { id: true },
    });

    const loanIds = managerLoans.map((loan) => loan.id);

    let recaudadoEsteMes = 0;
    if (loanIds.length > 0) {
      const pagosEsteMes = await this.prisma.payment.findMany({
        where: {
          subLoan: {
            loanId: { in: loanIds },
          },
          paymentDate: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      recaudadoEsteMes = pagosEsteMes.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );
    }

    // 4. Valor de Cartera: Capital Asignado + Total de Intereses de Préstamos Activos
    // No se incluye el capital disponible porque ese ya está en el capitalAsignado
    // Solo se suman los intereses pendientes de cobrar de los préstamos activos
    let totalInteresesPrestamosActivos = 0;
    if (loanIds.length > 0) {
      const prestamosActivos = await this.prisma.loan.findMany({
        where: {
          id: { in: loanIds },
          status: 'ACTIVE',
          deletedAt: null,
        },
        include: {
          subLoans: {
            where: {
              status: {
                in: ['PENDING', 'PARTIAL', 'OVERDUE'],
              },
            },
            select: {
              totalAmount: true, // Monto total de la cuota (capital + interés)
              amount: true,      // Monto del capital de la cuota
            },
          },
        },
      });

      // Calcular solo los intereses pendientes sumando (totalAmount - amount) de cada subloan
      for (const loan of prestamosActivos) {
        for (const subLoan of loan.subLoans) {
          const interesCuota = Number(subLoan.totalAmount) - Number(subLoan.amount);
          totalInteresesPrestamosActivos += interesCuota;
        }
      }
    }

    const valorCartera = capitalAsignado + totalInteresesPrestamosActivos;

    return {
      capitalDisponible,
      capitalAsignado,
      recaudadoEsteMes,
      valorCartera,
    };
  }
}
