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
import { ClientFiltersDto, LoanFiltersDto, ClientChartDataDto, LoanChartDataDto } from '../common/dto';
import { DateUtil } from '../common/utils';
import { SystemConfigService } from '../system-config/system-config.service';
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

    // Check user creation limits
    await this.validateUserCreationLimits(createUserDto.role, currentUser);

    // No DNI/CUIT validation needed - moved to Client model

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // No DNI/CUIT uniqueness validation needed - moved to Client model

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        createdById: currentUser.id,
      },
    });

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

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return convertPrismaUserToResponse(user);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: any,
  ): Promise<UserResponseDto> {
    const existingUser = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
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
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return convertPrismaUserToResponse(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: DateUtil.now().toJSDate() },
    });
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
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return createdUsers.map(convertPrismaUserToResponse);
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

  private async validateUserCreationLimits(
    newRole: UserRole,
    currentUser: any,
  ): Promise<void> {
    // SUPERADMIN has no limits
    if (currentUser.role === UserRole.SUPERADMIN) {
      return;
    }

    // Count current created users by the current user
    const createdUsersCount = await this.prisma.user.count({
      where: {
        createdById: currentUser.id,
        role: newRole,
        deletedAt: null,
      },
    });

    let maxAllowed = 0;
    let limitType = '';

    if (currentUser.role === UserRole.ADMIN && newRole === UserRole.SUBADMIN) {
      maxAllowed = await this.systemConfigService.getConfig(
        ConfigKey.ADMIN_MAX_SUBADMINS,
      );
      limitType = 'SUBADMIN';
    } else if (
      currentUser.role === UserRole.SUBADMIN &&
      newRole === UserRole.MANAGER
    ) {
      maxAllowed = await this.systemConfigService.getConfig(
        ConfigKey.SUBADMIN_MAX_MANAGERS,
      );
      limitType = 'MANAGER';
    }

    if (maxAllowed > 0 && createdUsersCount >= maxAllowed) {
      throw new ForbiddenException(
        `You have reached the maximum limit of ${maxAllowed} ${limitType} accounts. Current count: ${createdUsersCount}`,
      );
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
      whereClause.fullName = { contains: filters.fullName, mode: 'insensitive' };
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
      whereClause.fullName = { contains: filters.fullName, mode: 'insensitive' };
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
      const activeLoans = client.loans.filter((loan) => loan.status === 'ACTIVE').length;
      const totalAmount = client.loans.reduce((sum, loan) => sum + Number(loan.amount), 0);
      const activeAmount = client.loans
        .filter((loan) => loan.status === 'ACTIVE')
        .reduce((sum, loan) => sum + Number(loan.amount), 0);
      const lastLoanDate = client.loans.length > 0 
        ? client.loans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt
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
      whereClause.loanTrack = { contains: filters.loanTrack, mode: 'insensitive' };
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
      whereClause.loanTrack = { contains: filters.loanTrack, mode: 'insensitive' };
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
      const completedPayments = loan.subLoans.filter((sub) => sub.status === 'PAID').length;
      const pendingPayments = loan.totalPayments - completedPayments;
      const paidAmount = loan.subLoans.reduce((sum, sub) => sum + Number(sub.paidAmount || 0), 0);
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

  private async validateManagerAccess(managerId: string, currentUser: any): Promise<void> {
    // SUPERADMIN y ADMIN pueden acceder a cualquier manager
    if (currentUser.role === UserRole.SUPERADMIN || currentUser.role === UserRole.ADMIN) {
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
        throw new ForbiddenException('No puede acceder a datos de otros managers');
      }
      return;
    }

    throw new ForbiddenException('Acceso denegado');
  }
} 