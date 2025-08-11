import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { UserRole, ConfigKey } from '@prisma/client';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import { SystemConfigService } from '../system-config/system-config.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private systemConfigService: SystemConfigService,
  ) {}

  async create(createUserDto: CreateUserDto, currentUser: any): Promise<UserResponseDto> {
    // Check role permissions
    this.validateRoleCreation(createUserDto.role, currentUser.role);

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
    return result;
  }

  async findAll(paginationDto: PaginationDto): Promise<PaginatedResponse<UserResponseDto>> {
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
      data: users,
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

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, currentUser: any): Promise<UserResponseDto> {
    const existingUser = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // Check if user is trying to update their own role or a higher role
    if (updateUserDto.role && !this.canUpdateRole(existingUser.role, updateUserDto.role, currentUser.role)) {
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

    return user;
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
      data: { deletedAt: new Date() },
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

    return createdUsers;
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
      createdBy: user.createdBy,
      createdUsers,
    };
  }

  private validateRoleCreation(newRole: UserRole, currentUserRole: UserRole): void {
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

  private async validateUserCreationLimits(newRole: UserRole, currentUser: any): Promise<void> {
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
      maxAllowed = await this.systemConfigService.getConfig(ConfigKey.ADMIN_MAX_SUBADMINS);
      limitType = 'SUBADMIN';
    } else if (currentUser.role === UserRole.SUBADMIN && newRole === UserRole.MANAGER) {
      maxAllowed = await this.systemConfigService.getConfig(ConfigKey.SUBADMIN_MAX_MANAGERS);
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
      throw new BadRequestException('Either DNI or CUIT must be provided for MANAGER role');
    }
  }

  private async validateUniqueFieldsUpdate(id: string, updateData: any): Promise<void> {
    if (updateData.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: updateData.email, id: { not: id } },
      });
      if (existingEmail) {
        throw new BadRequestException('Email already exists');
      }
    }
  }

  private canUpdateRole(currentRole: UserRole, newRole: UserRole, userRole: UserRole): boolean {
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
} 