import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto';
import { UserRole, LoanStatus } from 'src/common/enums';
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

    // Verificar cuota disponible del manager
    const manager = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        clientQuota: true,
        usedClientQuota: true,
      },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
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

      // Verificar cuota antes de asignar cliente existente
      const availableQuota = manager.clientQuota - manager.usedClientQuota;
      if (availableQuota <= 0) {
        throw new BadRequestException(
          `No tiene cuota disponible para asignar clientes. Cuota utilizada: ${manager.usedClientQuota}/${manager.clientQuota}`,
        );
      }

      // Asignar el cliente existente al manager actual y actualizar cuota
      await this.prisma.$transaction([
        this.prisma.clientManager.create({
          data: {
            clientId: existingClient.id,
            userId: userId,
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: {
            usedClientQuota: {
              increment: 1,
            },
          },
        }),
      ]);

      return {
        ...existingClient,
        isExistingClient: true,
        message: 'Cliente existente asignado exitosamente',
      };
    }

    // Verificar cuota antes de crear nuevo cliente
    const availableQuota = manager.clientQuota - manager.usedClientQuota;
    if (availableQuota <= 0) {
      throw new BadRequestException(
        `No tiene cuota disponible para crear clientes. Cuota utilizada: ${manager.usedClientQuota}/${manager.clientQuota}`,
      );
    }

    // Crear nuevo cliente y actualizar cuota en una transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const newClient = await tx.client.create({
        data: {
          ...createClientDto,
          verified: false, // Siempre false al crear
        },
      });

      // Asignar el cliente al manager que lo creó
      await tx.clientManager.create({
        data: {
          clientId: newClient.id,
          userId: userId,
        },
      });

      // Incrementar la cuota utilizada
      await tx.user.update({
        where: { id: userId },
        data: {
          usedClientQuota: {
            increment: 1,
          },
        },
      });

      return newClient;
    });

    return {
      ...result,
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
            description: true,
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

    // Remover verified del DTO si está presente (no es editable)
    const { verified, ...updateData } = updateClientDto as any;
    if (verified !== undefined) {
      // Si intentan modificar verified, ignorarlo silenciosamente
    }

    const updatedClient = await this.prisma.client.update({
      where: { id },
      data: updateData,
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

    // Verificar si el cliente tiene préstamos activos
    const activeLoans = await this.prisma.loan.findMany({
      where: {
        clientId: id,
        deletedAt: null,
        status: {
          in: [
            LoanStatus.PENDING,
            LoanStatus.APPROVED,
            LoanStatus.ACTIVE,
            LoanStatus.DEFAULTED,
          ],
        },
      },
      select: {
        id: true,
        loanTrack: true,
        status: true,
      },
    });

    if (activeLoans.length > 0) {
      const loanTracks = activeLoans.map((loan) => loan.loanTrack).join(', ');
      throw new BadRequestException(
        `No se puede eliminar el cliente porque tiene ${activeLoans.length} préstamo(s) activo(s): ${loanTracks}`,
      );
    }

    // Hard delete - elimina permanentemente el cliente y sus relaciones
    // Primero eliminar la relación client-manager
    await this.prisma.clientManager.delete({
      where: { id: clientManager.id },
    });

    // Luego eliminar el cliente
    await this.prisma.client.delete({
      where: { id },
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

  async getInactiveClientsReport(userId: string, userRole: UserRole) {
    // Solo SUBADMIN y superiores pueden ver este reporte
    if (
      userRole !== UserRole.SUBADMIN &&
      userRole !== UserRole.ADMIN &&
      userRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'No tiene permisos para ver este reporte',
      );
    }

    let managerIds: string[] = [];

    if (userRole === UserRole.SUBADMIN) {
      // Obtener todos los managers del SUBADMIN
      managerIds = await this.getManagedUserIds(userId);
    } else {
      // ADMIN y SUPERADMIN pueden ver todos los managers
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
        totalInactiveClients: 0,
        managerDetails: [],
      };
    }

    // Para cada manager, obtener clientes sin préstamos activos
    const managerDetails = await Promise.all(
      managerIds.map(async (managerId) => {
        // Obtener info del manager
        const manager = await this.prisma.user.findUnique({
          where: { id: managerId },
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        });

        if (!manager) {
          return null;
        }

        // Obtener todos los clientes del manager
        const clientIds = await this.getManagedClientIds(managerId);

        if (clientIds.length === 0) {
          return {
            managerId: manager.id,
            managerName: manager.fullName,
            managerEmail: manager.email,
            inactiveClientsCount: 0,
          };
        }

        // Contar clientes sin préstamos activos
        const inactiveCount = await this.prisma.client.count({
          where: {
            id: { in: clientIds },
            deletedAt: null,
            OR: [
              // No tiene ningún préstamo
              {
                loans: {
                  none: {},
                },
              },
              // O todos sus préstamos no están activos
              {
                loans: {
                  every: {
                    status: {
                      notIn: ['ACTIVE', 'APPROVED', 'PENDING'],
                    },
                  },
                },
              },
            ],
          },
        });

        return {
          managerId: manager.id,
          managerName: manager.fullName,
          managerEmail: manager.email,
          inactiveClientsCount: inactiveCount,
        };
      }),
    );

    // Filtrar nulls y calcular total
    const validManagerDetails = managerDetails.filter((d) => d !== null);
    const totalInactiveClients = validManagerDetails.reduce(
      (sum, m) => sum + (m?.inactiveClientsCount || 0),
      0,
    );

    return {
      totalInactiveClients,
      managerDetails: validManagerDetails,
    };
  }

  /**
   * Obtener estadísticas de clientes nuevos por período (semana/mes)
   */
  async getClientStatsByPeriod(
    userId: string,
    userRole: UserRole,
    dateFrom?: string,
    dateTo?: string,
    groupBy: 'week' | 'month' = 'week',
  ) {
    // Determinar clientes accesibles
    let clientIds: string[] = [];

    if (userRole === UserRole.MANAGER) {
      clientIds = await this.getManagedClientIds(userId);
    } else if (userRole === UserRole.SUBADMIN) {
      const managers = await this.prisma.user.findMany({
        where: {
          role: UserRole.MANAGER,
          createdById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });

      for (const manager of managers) {
        const managerClients = await this.getManagedClientIds(manager.id);
        clientIds.push(...managerClients);
      }
    } else {
      // ADMIN/SUPERADMIN: todos los clientes
      const allClients = await this.prisma.client.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      clientIds = allClients.map((c) => c.id);
    }

    // Filtros de fecha
    const whereClause: any = {
      id: { in: clientIds },
      deletedAt: null,
    };

    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) {
        whereClause.createdAt.gte = DateUtil.parseToDate(dateFrom);
      }
      if (dateTo) {
        whereClause.createdAt.lte = DateUtil.parseToDate(dateTo);
      }
    }

    const clients = await this.prisma.client.findMany({
      where: whereClause,
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Agrupar por período
    const statsMap = new Map<string, number>();

    for (const client of clients) {
      let periodKey: string;

      if (groupBy === 'week') {
        // Formato: "Sem. DD/MM" (inicio de semana) - en zona horaria Argentina
        const dt = DateUtil.fromPrismaDate(client.createdAt);
        const startOfWeek = dt.startOf('week'); // Luxon usa lunes como inicio de semana

        periodKey = `Sem. ${startOfWeek.day.toString().padStart(2, '0')}/${startOfWeek.month.toString().padStart(2, '0')}`;
      } else {
        // Formato: "YYYY-MM" - en zona horaria Argentina
        const dt = DateUtil.fromPrismaDate(client.createdAt);
        periodKey = `${dt.year}-${dt.month.toString().padStart(2, '0')}`;
      }

      statsMap.set(periodKey, (statsMap.get(periodKey) || 0) + 1);
    }

    // Convertir a array y ordenar
    const stats = Array.from(statsMap.entries())
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => {
        if (groupBy === 'week') {
          // Extraer fechas para ordenar correctamente
          return a.period.localeCompare(b.period);
        }
        return a.period.localeCompare(b.period);
      });

    return {
      total: clients.length,
      groupBy,
      stats,
    };
  }

  async getInactiveClients(managerId: string): Promise<any> {
    // Obtener todos los clientes del manager
    const clients = await this.prisma.client.findMany({
      where: {
        deletedAt: null,
        managers: {
          some: {
            userId: managerId,
            deletedAt: null,
          },
        },
      },
      include: {
        loans: {
          where: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'APPROVED', 'PENDING'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
          },
        },
      },
    });

    // Filtrar clientes sin préstamos activos
    const inactiveClients = clients.filter((client) => client.loans.length === 0);

    // Obtener fecha de último préstamo para cada cliente (incluyendo préstamos completados)
    const clientsWithLastLoan = await Promise.all(
      inactiveClients.map(async (client) => {
        const lastLoan = await this.prisma.loan.findFirst({
          where: {
            clientId: client.id,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
          },
        });

        return {
          id: client.id,
          nombre: client.fullName,
          telefono: client.phone,
          direccion: client.address,
          fechaUltimoPrestamo: lastLoan?.createdAt || null,
        };
      }),
    );

    // Ordenar: primero los que nunca tuvieron préstamo (null), luego por fecha DESC
    clientsWithLastLoan.sort((a, b) => {
      if (!a.fechaUltimoPrestamo && !b.fechaUltimoPrestamo) return 0;
      if (!a.fechaUltimoPrestamo) return -1; // Los sin préstamo primero
      if (!b.fechaUltimoPrestamo) return 1;
      return b.fechaUltimoPrestamo.getTime() - a.fechaUltimoPrestamo.getTime(); // Más reciente primero
    });

    return {
      total: clientsWithLastLoan.length,
      clients: clientsWithLastLoan,
    };
  }

  async getActiveLoansClients(managerId: string): Promise<any> {
    // Obtener todos los clientes del manager con préstamos activos
    const clients = await this.prisma.client.findMany({
      where: {
        deletedAt: null,
        managers: {
          some: {
            userId: managerId,
            deletedAt: null,
          },
        },
        loans: {
          some: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'APPROVED', 'PENDING'] },
          },
        },
      },
      include: {
        loans: {
          where: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'APPROVED', 'PENDING'] },
          },
          select: {
            id: true,
            loanTrack: true,
            amount: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Transformar y ordenar por cantidad de préstamos activos (descendente)
    const clientsWithActiveLoans = clients
      .map((client) => ({
        id: client.id,
        nombre: client.fullName,
        telefono: client.phone,
        direccion: client.address,
        cantidadPrestamosActivos: client.loans.length,
        prestamosActivos: client.loans.map((loan) => ({
          id: loan.id,
          loanTrack: loan.loanTrack,
          amount: Number(loan.amount),
          status: loan.status,
          createdAt: loan.createdAt,
        })),
      }))
      .sort((a, b) => b.cantidadPrestamosActivos - a.cantidadPrestamosActivos); // Ordenar por cantidad descendente

    return {
      total: clientsWithActiveLoans.length,
      clients: clientsWithActiveLoans,
    };
  }

  /**
   * Verificar un cliente (solo accesible por el subadmin del manager que creó el cliente)
   */
  async verifyClient(clientId: string, subadminId: string): Promise<any> {
    // Obtener el cliente con sus managers
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        deletedAt: null,
      },
      include: {
        managers: {
          where: { deletedAt: null },
          include: {
            user: {
              select: {
                id: true,
                createdById: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    // Verificar que el cliente esté gestionado por un manager creado por este subadmin
    const isManagedBySubadminManager = client.managers.some((cm) => {
      const manager = cm.user;
      return (
        manager.role === UserRole.MANAGER &&
        manager.createdById === subadminId
      );
    });

    if (!isManagedBySubadminManager) {
      throw new ForbiddenException(
        'Solo puedes verificar clientes de managers que tú creaste',
      );
    }

    // Verificar que el cliente no esté ya verificado
    if (client.verified) {
      throw new BadRequestException('El cliente ya está verificado');
    }

    // Actualizar el cliente a verificado
    const updatedClient = await this.prisma.client.update({
      where: { id: clientId },
      data: { verified: true },
      include: {
        managers: {
          where: { deletedAt: null },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return {
      ...updatedClient,
      verified: true,
    };
  }

  /**
   * Obtener todos los clientes que necesitan verificación (solo subadmins)
   */
  async getUnverifiedClients(subadminId: string): Promise<any> {
    // Obtener todos los managers creados por este subadmin
    const managedUsers = await this.prisma.user.findMany({
      where: {
        createdById: subadminId,
        role: UserRole.MANAGER,
        deletedAt: null,
      },
      select: { id: true },
    });

    const managedUserIds = managedUsers.map((u) => u.id);

    if (managedUserIds.length === 0) {
      return {
        total: 0,
        clients: [],
      };
    }

    // Obtener todos los clientes no verificados gestionados por estos managers
    const unverifiedClients = await this.prisma.client.findMany({
      where: {
        verified: false,
        deletedAt: null,
        managers: {
          some: {
            userId: { in: managedUserIds },
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        address: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      total: unverifiedClients.length,
      clients: unverifiedClients.map((client) => ({
        id: client.id,
        nombre: client.fullName,
        telefono: client.phone,
        direccion: client.address,
      })),
    };
  }
}
