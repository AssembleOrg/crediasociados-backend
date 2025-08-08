import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto, currentUser: any): Promise<UserResponseDto> {
    // Check role permissions
    this.validateRoleCreation(createUserDto.role, currentUser.role);

    // Validate DNI/CUIT for MANAGER role
    if (createUserDto.role === UserRole.MANAGER) {
      this.validateUserFields(createUserDto);
    }

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // Check DNI/CUIT uniqueness for MANAGER role
    if (createUserDto.role === UserRole.MANAGER) {
      await this.validateUniqueFields(createUserDto);
    }

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
          dni: true,
          cuit: true,
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
        dni: true,
        cuit: true,
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

    // Validate DNI/CUIT for MANAGER role
    if (updateUserDto.role === UserRole.MANAGER || existingUser.role === UserRole.MANAGER) {
      this.validateUserFields({ ...existingUser, ...updateUserDto });
    }

    // Check unique fields if updating
    if (updateUserDto.email || updateUserDto.dni || updateUserDto.cuit) {
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
        dni: true,
        cuit: true,
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

  private validateRoleCreation(newRole: UserRole, currentUserRole: UserRole): void {
    const roleHierarchy: Record<UserRole, UserRole[]> = {
      [UserRole.SUPERADMIN]: [UserRole.ADMIN],
      [UserRole.ADMIN]: [UserRole.MANAGER],
      [UserRole.MANAGER]: [],
    };

    const allowedRoles = roleHierarchy[currentUserRole];
    if (!allowedRoles.includes(newRole)) {
      throw new ForbiddenException(`Cannot create user with role ${newRole}`);
    }
  }

  private validateUserFields(userData: any): void {
    if (!userData.dni && !userData.cuit) {
      throw new BadRequestException('Either DNI or CUIT must be provided for MANAGER role');
    }
  }

  private async validateUniqueFields(userData: any): Promise<void> {
    if (userData.dni) {
      const existingDni = await this.prisma.user.findUnique({
        where: { dni: userData.dni },
      });
      if (existingDni) {
        throw new BadRequestException('DNI already exists');
      }
    }

    if (userData.cuit) {
      const existingCuit = await this.prisma.user.findUnique({
        where: { cuit: userData.cuit },
      });
      if (existingCuit) {
        throw new BadRequestException('CUIT already exists');
      }
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

    if (updateData.dni) {
      const existingDni = await this.prisma.user.findFirst({
        where: { dni: updateData.dni, id: { not: id } },
      });
      if (existingDni) {
        throw new BadRequestException('DNI already exists');
      }
    }

    if (updateData.cuit) {
      const existingCuit = await this.prisma.user.findFirst({
        where: { cuit: updateData.cuit, id: { not: id } },
      });
      if (existingCuit) {
        throw new BadRequestException('CUIT already exists');
      }
    }
  }

  private canUpdateRole(currentRole: UserRole, newRole: UserRole, userRole: UserRole): boolean {
    // Only allow updating roles within the user's permission scope
    const roleHierarchy: Record<UserRole, UserRole[]> = {
      [UserRole.SUPERADMIN]: [UserRole.ADMIN],
      [UserRole.ADMIN]: [UserRole.MANAGER],
      [UserRole.MANAGER]: [],
    };

    const allowedRoles = roleHierarchy[userRole];
    return allowedRoles.includes(newRole);
  }
} 