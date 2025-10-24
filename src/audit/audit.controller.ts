import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuditService, AuditAction } from '../common/services/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';

@ApiTags('Audit & Logs')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Obtener logs de auditoría',
    description:
      'Consulta los logs de auditoría del sistema con filtros opcionales. Solo accesible para SUPERADMIN y ADMIN.',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Filtrar por ID de usuario',
  })
  @ApiQuery({
    name: 'entity',
    required: false,
    type: String,
    description: 'Filtrar por entidad (User, Loan, Client, etc.)',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: AuditAction,
    description: 'Filtrar por acción (CREATE, READ, UPDATE, DELETE, etc.)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Fecha de inicio (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Fecha de fin (ISO 8601)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Logs de auditoría obtenidos exitosamente',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              userId: { type: 'string' },
              userEmail: { type: 'string' },
              userRole: { type: 'string' },
              action: { type: 'string' },
              entity: { type: 'string' },
              entityId: { type: 'string' },
              changes: { type: 'object' },
              ip: { type: 'string' },
              userAgent: { type: 'string' },
              endpoint: { type: 'string' },
              method: { type: 'string' },
              statusCode: { type: 'number' },
              description: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Acceso denegado' })
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: AuditAction,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    return this.auditService.getAuditLogs({
      userId,
      entity,
      action,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page,
      limit,
    });
  }

  @Get('http-logs')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Obtener logs HTTP',
    description:
      'Consulta los logs de todas las requests HTTP del sistema con filtros opcionales. Solo accesible para SUPERADMIN y ADMIN.',
  })
  @ApiQuery({
    name: 'method',
    required: false,
    type: String,
    description: 'Filtrar por método HTTP (GET, POST, PUT, DELETE, etc.)',
  })
  @ApiQuery({
    name: 'statusCode',
    required: false,
    type: Number,
    description: 'Filtrar por código de estado HTTP',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Filtrar por ID de usuario',
  })
  @ApiQuery({
    name: 'endpoint',
    required: false,
    type: String,
    description: 'Filtrar por endpoint (búsqueda parcial)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Fecha de inicio (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Fecha de fin (ISO 8601)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Logs HTTP obtenidos exitosamente',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              method: { type: 'string' },
              url: { type: 'string' },
              endpoint: { type: 'string' },
              statusCode: { type: 'number' },
              responseTime: { type: 'number' },
              ip: { type: 'string' },
              userAgent: { type: 'string' },
              userId: { type: 'string' },
              userEmail: { type: 'string' },
              requestBody: { type: 'object' },
              responseBody: { type: 'object' },
              queryParams: { type: 'object' },
              headers: { type: 'object' },
              errorMessage: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Acceso denegado' })
  async getHttpLogs(
    @Query('method') method?: string,
    @Query('statusCode', new DefaultValuePipe(0), ParseIntPipe)
    statusCode?: number,
    @Query('userId') userId?: string,
    @Query('endpoint') endpoint?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    return this.auditService.getHttpLogs({
      method,
      statusCode: statusCode !== 0 ? statusCode : undefined,
      userId,
      endpoint,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page,
      limit,
    });
  }
}

