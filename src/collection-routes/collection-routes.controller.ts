import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CollectionRoutesService } from './collection-routes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import {
  CollectionRouteResponseDto,
  UpdateRouteOrderDto,
  CloseRouteDto,
  GetRoutesQueryDto,
  CreateRouteExpenseDto,
  UpdateRouteExpenseDto,
  RouteExpenseResponseDto,
  TodayExpensesDto,
} from './dto';

@ApiTags('Collection Routes')
@Controller('collection-routes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CollectionRoutesController {
  constructor(
    private readonly collectionRoutesService: CollectionRoutesService,
  ) {}

  @Get('today')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener la ruta de cobro activa del día',
    description:
      'Retorna la ruta de cobro activa para el día actual. ' +
      'Los MANAGERS ven su propia ruta. ' +
      'Los SUBADMIN/ADMIN pueden especificar un managerId para ver la ruta de un manager específico.',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    description: 'ID del manager (requerido para SUBADMIN/ADMIN)',
    example: 'manager_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Ruta activa obtenida exitosamente',
    type: CollectionRouteResponseDto,
  })
  @ApiResponse({
    status: 404,
    description:
      'No hay ruta activa para hoy. Se creará automáticamente a las 4:15 AM',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayActiveRoute(
    @Request() req,
    @Query('managerId') managerId?: string,
  ): Promise<CollectionRouteResponseDto> {
    return this.collectionRoutesService.getTodayActiveRoute(
      req.user.id,
      req.user.role,
      managerId,
    );
  }

  @Get()
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener rutas de cobro con filtros',
    description:
      'Retorna rutas de cobro con filtros opcionales de estado, fechas y manager. ' +
      'Los MANAGERS solo ven sus propias rutas. ' +
      'Los SUBADMIN ven rutas de sus managers. ' +
      'Los ADMIN/SUPERADMIN ven todas las rutas.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'CLOSED'],
    description: 'Filtrar por estado',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Fecha desde (ISO 8601)',
    example: '2025-10-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Fecha hasta (ISO 8601)',
    example: '2025-10-31T23:59:59.999Z',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    description: 'ID del manager (para SUBADMIN/ADMIN)',
    example: 'manager_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Rutas obtenidas exitosamente',
    type: [CollectionRouteResponseDto],
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getRoutes(
    @Request() req,
    @Query() query: GetRoutesQueryDto,
  ): Promise<CollectionRouteResponseDto[]> {
    return this.collectionRoutesService.getRoutes(
      req.user.id,
      req.user.role,
      query,
    );
  }

  @Get(':routeId')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener una ruta específica por ID',
    description:
      'Retorna los detalles completos de una ruta de cobro específica.',
  })
  @ApiParam({
    name: 'routeId',
    description: 'ID de la ruta',
    example: 'route_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Ruta obtenida exitosamente',
    type: CollectionRouteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta ruta' })
  async getRouteById(
    @Request() req,
    @Param('routeId') routeId: string,
  ): Promise<CollectionRouteResponseDto> {
    return this.collectionRoutesService.getRouteById(
      routeId,
      req.user.id,
      req.user.role,
    );
  }

  @Put(':routeId/order')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Actualizar el orden de los items de una ruta',
    description:
      'Permite reordenar los items de una ruta de cobro activa. ' +
      'Solo disponible para rutas con estado ACTIVE. ' +
      'El MANAGER puede reordenar su propia ruta. ' +
      'El SUBADMIN puede reordenar rutas de sus managers.',
  })
  @ApiParam({
    name: 'routeId',
    description: 'ID de la ruta',
    example: 'route_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Orden actualizado exitosamente',
    type: CollectionRouteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede modificar una ruta cerrada',
  })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta ruta' })
  async updateRouteOrder(
    @Request() req,
    @Param('routeId') routeId: string,
    @Body() updateDto: UpdateRouteOrderDto,
  ): Promise<CollectionRouteResponseDto> {
    return this.collectionRoutesService.updateRouteOrder(
      routeId,
      req.user.id,
      req.user.role,
      updateDto,
    );
  }

  @Post(':routeId/close')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Cerrar una ruta de cobro',
    description:
      'Cierra una ruta de cobro activa y calcula los totales finales. ' +
      'Al cerrar, se calculan automáticamente: ' +
      '- Montos cobrados (suma de transacciones INCOME de cada subloan) ' +
      '- Montos gastados (suma de transacciones EXPENSE de cada subloan) ' +
      '- Montos netos (cobrado - gastado) ' +
      'Los datos se mantienen en el sistema para consultas futuras. ' +
      'La respuesta incluye todos los detalles de los gastos (expenses) con sus descripciones.',
  })
  @ApiParam({
    name: 'routeId',
    description: 'ID de la ruta a cerrar',
    example: 'route_id_here',
  })
  @ApiResponse({
    status: 200,
    description:
      'Ruta cerrada exitosamente con totales calculados y detalles de expenses',
    type: CollectionRouteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Esta ruta ya está cerrada',
  })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta ruta' })
  async closeRoute(
    @Request() req,
    @Param('routeId') routeId: string,
    @Body() closeDto: CloseRouteDto,
  ): Promise<CollectionRouteResponseDto> {
    return this.collectionRoutesService.closeRoute(
      routeId,
      req.user.id,
      req.user.role,
      closeDto,
    );
  }

  @Post('create-daily')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Crear rutas de cobro para hoy (manual)',
    description:
      'Crea manualmente las rutas de cobro para todos los managers con subloans activos para hoy. ' +
      'Este endpoint normalmente se ejecuta automáticamente a las 4:15 AM. ' +
      'Solo para ADMIN/SUPERADMIN para testing o recuperación.',
  })
  @ApiResponse({
    status: 201,
    description: 'Rutas creadas exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Se crearon 5 rutas de cobro',
        },
        createdRoutes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              managerId: { type: 'string' },
              managerName: { type: 'string' },
              routeId: { type: 'string' },
              itemsCount: { type: 'number' },
            },
          },
        },
        date: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 403,
    description: 'Prohibido - Solo para ADMIN/SUPERADMIN',
  })
  async createDailyRoutes(@Request() req): Promise<any> {
    return this.collectionRoutesService.createDailyRoutes();
  }

  @Post('create-daily-november')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Crear rutas de cobro para noviembre (del 15 al 30 de noviembre de 2025)',
    description:
      'Crea manualmente las rutas de cobro para todos los managers con subloans activos ' +
      'desde el 15 de noviembre hasta el 30 de noviembre de 2025. ' +
      'Útil para testing y simulación de rutas históricas. ' +
      'Solo para ADMIN/SUPERADMIN.',
  })
  @ApiResponse({
    status: 201,
    description: 'Rutas creadas exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Se crearon 25 rutas de cobro para el período del 15 de noviembre hasta hoy',
        },
        totalRoutesCreated: {
          type: 'number',
          example: 25,
        },
        period: {
          type: 'object',
          properties: {
            start: { type: 'string', example: '15/11/2024' },
            end: { type: 'string', example: '20/11/2024' },
          },
        },
        dailySummaries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', example: '15/11/2024' },
              routesCreated: { type: 'number', example: 2 },
              routes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    managerId: { type: 'string' },
                    managerName: { type: 'string' },
                    routeId: { type: 'string' },
                    itemsCount: { type: 'number' },
                    date: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        allCreatedRoutes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              managerId: { type: 'string' },
              managerName: { type: 'string' },
              routeId: { type: 'string' },
              itemsCount: { type: 'number' },
              date: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 403,
    description: 'Prohibido - Solo para ADMIN/SUPERADMIN',
  })
  async createDailyRoutesForNovember(@Request() req): Promise<any> {
    return this.collectionRoutesService.createDailyRoutesForNovember();
  }

  @Post(':routeId/expenses')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Agregar un gasto a una ruta',
    description:
      'Agrega un nuevo gasto a una ruta activa. ' +
      'Categorías disponibles: COMBUSTIBLE, CONSUMO, REPARACIONES, OTROS',
  })
  @ApiParam({
    name: 'routeId',
    description: 'ID de la ruta',
    example: 'route_id_here',
  })
  @ApiResponse({
    status: 201,
    description: 'Gasto agregado exitosamente',
    type: RouteExpenseResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden agregar gastos a rutas activas',
  })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta ruta' })
  async createRouteExpense(
    @Request() req,
    @Param('routeId') routeId: string,
    @Body() createExpenseDto: CreateRouteExpenseDto,
  ): Promise<RouteExpenseResponseDto> {
    return this.collectionRoutesService.createRouteExpense(
      routeId,
      req.user.id,
      req.user.role,
      createExpenseDto,
    );
  }

  @Put('expenses/:expenseId')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Actualizar un gasto',
    description: 'Actualiza un gasto existente de una ruta activa',
  })
  @ApiParam({
    name: 'expenseId',
    description: 'ID del gasto',
    example: 'expense_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Gasto actualizado exitosamente',
    type: RouteExpenseResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden modificar gastos de rutas activas',
  })
  @ApiResponse({ status: 404, description: 'Gasto no encontrado' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a este gasto' })
  async updateRouteExpense(
    @Request() req,
    @Param('expenseId') expenseId: string,
    @Body() updateExpenseDto: UpdateRouteExpenseDto,
  ): Promise<RouteExpenseResponseDto> {
    return this.collectionRoutesService.updateRouteExpense(
      expenseId,
      req.user.id,
      req.user.role,
      updateExpenseDto,
    );
  }

  @Delete('expenses/:expenseId')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Eliminar un gasto',
    description: 'Elimina un gasto de una ruta activa',
  })
  @ApiParam({
    name: 'expenseId',
    description: 'ID del gasto',
    example: 'expense_id_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Gasto eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Gasto eliminado exitosamente',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden eliminar gastos de rutas activas',
  })
  @ApiResponse({ status: 404, description: 'Gasto no encontrado' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a este gasto' })
  async deleteRouteExpense(
    @Request() req,
    @Param('expenseId') expenseId: string,
  ): Promise<{ message: string }> {
    return this.collectionRoutesService.deleteRouteExpense(
      expenseId,
      req.user.id,
      req.user.role,
    );
  }

  @Get('today/expenses')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener gastos realizados hoy',
    description: 'Devuelve la lista de gastos creados en la fecha actual con monto, categoría, descripción e información del manager',
  })
  @ApiResponse({
    status: 200,
    description: 'Gastos de hoy obtenidos exitosamente',
    type: TodayExpensesDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayExpenses(@Request() req): Promise<TodayExpensesDto> {
    return this.collectionRoutesService.getTodayExpenses(
      req.user.id,
      req.user.role,
    );
  }
}

