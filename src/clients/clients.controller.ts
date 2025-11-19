import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import {
  CreateClientDto,
  UpdateClientDto,
  InactiveClientsResponseDto,
  InactiveClientsDto,
  ActiveLoansClientsDto,
  UnverifiedClientsDto,
} from './dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums';

@ApiTags('Clients')
@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new client (MANAGER only)' })
  @ApiResponse({
    status: 201,
    description: 'Client created successfully or existing client assigned',
    schema: {
      type: 'object',
      properties: {
        data: {
          oneOf: [
            { $ref: '#/components/schemas/ClientResponseDto' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                fullName: { type: 'string' },
                dni: { type: 'string' },
                cuit: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string' },
                address: { type: 'string' },
                job: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
                isExistingClient: { type: 'boolean' },
                message: { type: 'string' },
              },
            },
          ],
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or client already assigned',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async create(
    @Body() createClientDto: CreateClientDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.create(
      createClientDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'Get all clients with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Clients retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/ClientWithManagersDto' },
            },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query() paginationDto: PaginationDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.findAll(
      paginationDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Get('search')
  @ApiOperation({ summary: 'Search client by DNI or CUIT' })
  @ApiQuery({ name: 'dni', required: false, type: String, example: '12345678' })
  @ApiQuery({
    name: 'cuit',
    required: false,
    type: String,
    example: '20-12345678-9',
  })
  @ApiResponse({
    status: 200,
    description: 'Client found successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientWithManagersDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Missing DNI or CUIT',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async searchByDniOrCuit(
    @Query('dni') dni?: string,
    @Query('cuit') cuit?: string,
  ) {
    const result = await this.clientsService.searchByDniOrCuit(dni, cuit);
    return result;
  }

  @Get('inactive')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Obtener clientes sin préstamos activos de un manager',
    description:
      'Devuelve la lista de clientes de un manager que no tienen préstamos activos. ' +
      'Incluye solo: nombre, teléfono, dirección y fecha de último préstamo. ' +
      'Ordenados por fecha de último préstamo DESC (los que nunca tuvieron préstamo aparecen primero). ' +
      'MANAGER solo puede ver sus propios clientes. SUBADMIN puede ver clientes de sus managers.',
  })
  @ApiQuery({
    name: 'managerId',
    required: true,
    description: 'ID del manager del cual obtener los clientes',
    example: 'cmht5jiq20008gxv2ndk6mj8i',
  })
  @ApiResponse({
    status: 200,
    description: 'Clientes inactivos obtenidos exitosamente',
    type: InactiveClientsDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos para ver estos clientes' })
  @ApiResponse({ status: 400, description: 'managerId es requerido' })
  async getInactiveClients(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId: string,
  ): Promise<InactiveClientsDto> {
    if (!managerId) {
      throw new BadRequestException('managerId es requerido');
    }

    // Validar permisos según el rol
    if (currentUser.role === UserRole.MANAGER) {
      // MANAGER solo puede ver sus propios clientes
      if (managerId !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver tus propios clientes inactivos',
        );
      }
    } else if (currentUser.role === UserRole.SUBADMIN) {
      // SUBADMIN puede ver clientes de sus managers
      const manager = await this.clientsService['prisma'].user.findUnique({
        where: { id: managerId },
        select: { createdById: true, role: true },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (manager.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver clientes de managers que tú creaste',
        );
      }
    }

    return this.clientsService.getInactiveClients(managerId);
  }

  @Get('active-loans')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener clientes con préstamos activos',
    description:
      'Retorna la lista de clientes que tienen préstamos activos, ordenados por cantidad de préstamos activos (descendente). ' +
      'Incluye nombre, teléfono, dirección y lista de préstamos activos. ' +
      'Solo para MANAGER y SUBADMIN.',
  })
  @ApiQuery({
    name: 'managerId',
    required: true,
    description: 'ID del manager',
    example: 'cmht5jiq20008gxv2ndk6mj8i',
  })
  @ApiResponse({
    status: 200,
    description: 'Clientes con préstamos activos obtenidos exitosamente',
    type: ActiveLoansClientsDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos para ver estos clientes' })
  @ApiResponse({ status: 400, description: 'managerId es requerido' })
  async getActiveLoansClients(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId: string,
  ): Promise<ActiveLoansClientsDto> {
    if (!managerId) {
      throw new BadRequestException('managerId es requerido');
    }

    // Validar permisos según el rol
    if (currentUser.role === UserRole.MANAGER) {
      // MANAGER solo puede ver sus propios clientes
      if (managerId !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver tus propios clientes con préstamos activos',
        );
      }
    } else if (currentUser.role === UserRole.SUBADMIN) {
      // SUBADMIN puede ver clientes de sus managers
      const manager = await this.clientsService['prisma'].user.findUnique({
        where: { id: managerId },
        select: { createdById: true, role: true },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (manager.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver clientes de managers que tú creaste',
        );
      }
    }

    return this.clientsService.getActiveLoansClients(managerId);
  }

  @Get('unverified')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Obtener clientes que necesitan verificación',
    description:
      'Retorna la lista de clientes no verificados gestionados por managers del subadmin. ' +
      'Incluye solo: nombre, teléfono y dirección.',
  })
  @ApiResponse({
    status: 200,
    description: 'Clientes no verificados obtenidos exitosamente',
    type: UnverifiedClientsDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Solo SUBADMIN puede acceder' })
  async getUnverifiedClients(
    @CurrentUser() currentUser: any,
  ): Promise<UnverifiedClientsDto> {
    return this.clientsService.getUnverifiedClients(currentUser.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific client by ID' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientWithDetailsDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async findOne(@Param('id') id: string, @CurrentUser() currentUser: any) {
    const result = await this.clientsService.findOne(
      id,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a client (MANAGER only)' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client updated successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientResponseDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or duplicate DNI/CUIT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.update(
      id,
      updateClientDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a client permanently (MANAGER only)' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client deleted successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async remove(@Param('id') id: string, @CurrentUser() currentUser: any) {
    const result = await this.clientsService.remove(
      id,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Get('reports/inactive')
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary:
      'Get report of clients without active loans (SUBADMIN+ only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Inactive clients report',
    type: InactiveClientsResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async getInactiveClientsReport(@CurrentUser() currentUser: any) {
    return this.clientsService.getInactiveClientsReport(
      currentUser.id,
      currentUser.role,
    );
  }

  @Get('stats/by-period')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener estadísticas de clientes nuevos por período',
    description:
      'Retorna el número de clientes nuevos agrupados por semana o mes. ' +
      'MANAGER ve sus clientes, SUBADMIN ve clientes de sus managers, ADMIN/SUPERADMIN ven todos.',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Fecha desde (ISO 8601)',
    example: '2025-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Fecha hasta (ISO 8601)',
    example: '2025-12-31T23:59:59.999Z',
  })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    enum: ['week', 'month'],
    description: 'Agrupar por semana o mes',
    example: 'week',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', example: 50 },
        groupBy: { type: 'string', example: 'week' },
        stats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              period: { type: 'string', example: 'Sem. 19/10' },
              count: { type: 'number', example: 5 },
            },
          },
        },
      },
    },
  })
  async getClientStatsByPeriod(
    @CurrentUser() currentUser: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy: 'week' | 'month' = 'week',
  ) {
    return this.clientsService.getClientStatsByPeriod(
      currentUser.id,
      currentUser.role,
      dateFrom,
      dateTo,
      groupBy,
    );
  }

  @Patch(':id/verify')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Verificar un cliente',
    description:
      'Marca un cliente como verificado. Solo accesible por el subadmin del manager que creó el cliente.',
  })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Cliente verificado exitosamente',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            fullName: { type: 'string' },
            verified: { type: 'boolean' },
          },
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Cliente ya está verificado',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - No tienes permisos para verificar este cliente',
  })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  async verifyClient(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.verifyClient(
      id,
      currentUser.id,
    );
    return {
      data: result,
      message: 'Cliente verificado exitosamente',
      success: true,
      timestamp: new Date().toISOString(),
    };
  }
}
