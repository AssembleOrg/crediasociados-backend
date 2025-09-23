import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto';
import { UserRole } from 'src/common/enums';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import { DateUtil } from '../common/utils';
import { ClientManager } from '@prisma/client';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(
    createClientDto: CreateClientDto,
    userId: string,
    userRole: UserRole,
  ) {
    // Solo MANAGER puede crear clients
    if (userRole !== UserRole.MANAGER) {
      throw new ForbiddenException('Solo los MANAGER pueden crear clientes');
    }

    // Validar que al menos DNI o CUIT esté presente
    if (!createClientDto.dni && !createClientDto.cuit) {
      throw new BadRequestException('Debe proporcionar al menos DNI o CUIT');
    }

    // Verificar si ya existe un cliente con el mismo DNI o CUIT
    let existingClient: any = null;
    if (createClientDto.dni) {
      existingClient = await this.prisma.client.findFirst({
        where: {
          dni: createClientDto.dni,
          deletedAt: null,
        },
        include: {
          managers: {
            where: { deletedAt: null },
            include: { user: true },
          },
        },
      });
    }

    if (!existingClient && createClientDto.cuit) {
      existingClient = await this.prisma.client.findFirst({
        where: {
          cuit: createClientDto.cuit,
          deletedAt: null,
        },
        include: {
          managers: {
            where: { deletedAt: null },
            include: { user: true },
          },
        },
      });
    }

    if (existingClient) {
      // El cliente ya existe, verificar si ya está asignado al manager actual
      const isAlreadyManaged = existingClient.managers.some(
        (manager: ClientManager) =>
          manager.userId === userId && !manager.deletedAt,
      );

      if (isAlreadyManaged) {
        throw new BadRequestException('Este cliente ya está asignado a usted');
      }

      // Asignar el cliente existente al manager actual
      await this.prisma.clientManager.create({
        data: {
          clientId: existingClient.id,
          userId: userId,
        },
      });

      return {
        ...existingClient,
        isExistingClient: true,
        message: 'Cliente existente asignado exitosamente',
      };
    }

    // Crear nuevo cliente
    const newClient = await this.prisma.client.create({
      data: createClientDto,
    });

    // Asignar el cliente al manager que lo creó
    await this.prisma.clientManager.create({
      data: {
        clientId: newClient.id,
        userId: userId,
      },
    });

    return {
      ...newClient,
      isExistingClient: false,
      message: 'Cliente creado exitosamente',
    };
  }

  async findAll(
    paginationDto: PaginationDto,
    userId: string,
    userRole: UserRole,
  ) {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    const whereClause: any = { deletedAt: null };

    // Si es MANAGER, solo ver sus clientes asignados
    if (userRole === UserRole.MANAGER) {
      const managedClientIds = await this.getManagedClientIds(userId);
      whereClause.id = { in: managedClientIds };
    }
    // Si es SUBADMIN, ver clientes de sus MANAGER
    else if (userRole === UserRole.SUBADMIN) {
      const managedUserIds = await this.getManagedUserIds(userId);
      const managedClientIds =
        await this.getManagedClientIdsByUsers(managedUserIds);
      whereClause.id = { in: managedClientIds };
    }
    // Si es ADMIN o SUPERADMIN, ver todos los clientes
    // whereClause se mantiene como está (todos los clientes)

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

  async findOne(id: string, userId: string, userRole: UserRole) {
    const client = await this.prisma.client.findFirst({
      where: { id, deletedAt: null },
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
        loans: {
          where: { deletedAt: null },
          select: {
            id: true,
            amount: true,
            status: true,
            loanTrack: true,
            createdAt: true,
            _count: {
              select: {
                subLoans: true,
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
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    // Verificar permisos de acceso
    if (userRole === UserRole.MANAGER) {
      const isManaged = client.managers.some(
        (manager: ClientManager) =>
          manager.userId === userId && !manager.deletedAt,
      );
      if (!isManaged) {
        throw new ForbiddenException('No tiene acceso a este cliente');
      }
    } else if (userRole === UserRole.SUBADMIN) {
      const managedUserIds = await this.getManagedUserIds(userId);
      const isManagedBySubordinate = client.managers.some(
        (manager: ClientManager) =>
          managedUserIds.includes(manager.userId) && !manager.deletedAt,
      );
      if (!isManagedBySubordinate) {
        throw new ForbiddenException('No tiene acceso a este cliente');
      }
    }
    // ADMIN y SUPERADMIN pueden acceder a todos los clientes

    return client;
  }

  async update(
    id: string,
    updateClientDto: UpdateClientDto,
    userId: string,
    userRole: UserRole,
  ) {
    // Verificar que el cliente existe y el usuario tiene acceso
    await this.findOne(id, userId, userRole);

    // Solo MANAGER puede actualizar clientes
    if (userRole !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Solo los MANAGER pueden actualizar clientes',
      );
    }

    // Verificar que el manager está asignado al cliente
    const clientManager = await this.prisma.clientManager.findFirst({
      where: {
        clientId: id,
        userId: userId,
        deletedAt: null,
      },
    });

    if (!clientManager) {
      throw new ForbiddenException(
        'No tiene permisos para actualizar este cliente',
      );
    }

    // Si se está actualizando DNI o CUIT, verificar duplicidad
    if (updateClientDto.dni || updateClientDto.cuit) {
      const existingClient = await this.prisma.client.findFirst({
        where: {
          OR: [
            ...(updateClientDto.dni ? [{ dni: updateClientDto.dni }] : []),
            ...(updateClientDto.cuit ? [{ cuit: updateClientDto.cuit }] : []),
          ],
          id: { not: id }, // Excluir el cliente actual
          deletedAt: null,
        },
      });

      if (existingClient) {
        throw new BadRequestException(
          'Ya existe un cliente con este DNI o CUIT',
        );
      }
    }

    const updatedClient = await this.prisma.client.update({
      where: { id },
      data: updateClientDto,
    });

    return updatedClient;
  }

  async remove(id: string, userId: string, userRole: UserRole) {
    // Verificar que el cliente existe y el usuario tiene acceso
    await this.findOne(id, userId, userRole);

    // Solo MANAGER puede eliminar clientes
    if (userRole !== UserRole.MANAGER) {
      throw new ForbiddenException('Solo los MANAGER pueden eliminar clientes');
    }

    // Verificar que el manager está asignado al cliente
    const clientManager = await this.prisma.clientManager.findFirst({
      where: {
        clientId: id,
        userId: userId,
        deletedAt: null,
      },
    });

    if (!clientManager) {
      throw new ForbiddenException(
        'No tiene permisos para eliminar este cliente',
      );
    }

    // Soft delete del cliente
    await this.prisma.client.update({
      where: { id },
      data: { deletedAt: DateUtil.now().toJSDate() },
    });

    // Soft delete de la relación client-manager
    await this.prisma.clientManager.update({
      where: { id: clientManager.id },
      data: { deletedAt: DateUtil.now().toJSDate() },
    });

    return { message: 'Cliente eliminado exitosamente' };
  }

  async searchByDniOrCuit(dni?: string, cuit?: string) {
    if (!dni && !cuit) {
      throw new BadRequestException(
        'Debe proporcionar DNI o CUIT para la búsqueda',
      );
    }

    const whereClause: any = { deletedAt: null };
    if (dni) whereClause.dni = dni;
    if (cuit) whereClause.cuit = cuit;

    const client = await this.prisma.client.findFirst({
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
      },
    });

    return client;
  }

  private async getManagedClientIds(userId: string): Promise<string[]> {
    const managedClients = await this.prisma.clientManager.findMany({
      where: {
        userId: userId,
        deletedAt: null,
      },
      select: { clientId: true },
    });

    return managedClients.map((mc) => mc.clientId);
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

  private async getManagedClientIdsByUsers(
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];

    const managedClients = await this.prisma.clientManager.findMany({
      where: {
        userId: { in: userIds },
        deletedAt: null,
      },
      select: { clientId: true },
    });

    return managedClients.map((mc) => mc.clientId);
  }
}
