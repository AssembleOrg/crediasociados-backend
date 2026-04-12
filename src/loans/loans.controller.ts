import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Type, plainToClass } from 'class-transformer';
import { LoansService } from './loans.service';
import {
  CreateLoanDto,
  LoanTrackingResponseDto,
  CreateLoanResponseDto,
  LoanListResponseDto,
  TodayLoansDto,
  TodayLoanItemDto,
  UpdateLoanDescriptionDto,
  UpdateLoanFirstDueDateDto,
} from './dto';
import { LoanFiltersDto, LoanChartDataDto } from '../common/dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { Public } from '../common/decorators/public.decorator';
import { PaginatedResponseDto } from 'src/common/dto/paginated-response.dto';

@ApiTags('Loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new loan' })
  @ApiResponse({
    status: 201,
    description: 'Préstamo creado exitosamente',
    type: CreateLoanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Solicitud incorrecta' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Rol insuficiente' })
  async createLoan(@Body() createLoanDto: CreateLoanDto, @Request() req) {
    const result = await this.loansService.createLoan(
      createLoanDto,
      req.user.id,
    );

    if (!result) {
      throw new BadRequestException('Error al crear el préstamo');
    }

    // Manual transformation to avoid class-transformer issues
    const transformedResult = {
      ...result,
      // Transform numeric fields manually
      amount: result.amount ? Number(result.amount) : result.amount,
      baseInterestRate: result.baseInterestRate
        ? Number(result.baseInterestRate)
        : result.baseInterestRate,
      penaltyInterestRate: result.penaltyInterestRate
        ? Number(result.penaltyInterestRate)
        : result.penaltyInterestRate,
      originalAmount: result.originalAmount
        ? Number(result.originalAmount)
        : result.originalAmount,
      // Transform subLoans
      subLoans:
        result.subLoans?.map((subLoan) => ({
          ...subLoan,
          amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
          totalAmount: subLoan.totalAmount
            ? Number(subLoan.totalAmount)
            : subLoan.totalAmount,
          paidAmount: subLoan.paidAmount
            ? Number(subLoan.paidAmount)
            : subLoan.paidAmount,
        })) || [],
    };

    return transformedResult;
  }

  @Get('tracking')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 requests per minute per IP
  @ApiOperation({
    summary:
      'Obtener información del préstamo por DNI y código de tracking (Endpoint público)',
  })
  @ApiQuery({
    name: 'dni',
    description: 'Número de DNI del cliente',
    example: '12345678',
  })
  @ApiQuery({
    name: 'tracking',
    description: 'Código de tracking del préstamo',
    example: 'LOAN-2024-001',
  })
  @ApiResponse({
    status: 200,
    description: 'Información del préstamo obtenida exitosamente',
    type: LoanTrackingResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Solicitud incorrecta - Parámetros faltantes',
  })
  @ApiResponse({
    status: 404,
    description: 'Préstamo no encontrado o DNI no coincide',
  })
  async getLoanByTracking(
    @Query('dni') dni: string,
    @Query('tracking') tracking: string,
  ) {
    if (!dni || !tracking) {
      throw new BadRequestException(
        'Se requieren tanto el DNI como el código de tracking',
      );
    }

    return this.loansService.getLoanByTracking(dni, tracking);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener todos los préstamos con filtros y paginación',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Número de página',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Elementos por página',
    example: 10,
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager',
    example: 'manager_id_here',
  })
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: 'ID del cliente',
    example: 'client_id_here',
  })
  @ApiQuery({
    name: 'loanTrack',
    required: false,
    type: String,
    description: 'Código de tracking del préstamo',
    example: 'LOAN-2024-001',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE'],
    description: 'Estado del préstamo',
    example: 'ACTIVE',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    enum: ['ARS', 'USD'],
    description: 'Moneda del préstamo',
    example: 'ARS',
  })
  @ApiQuery({
    name: 'paymentFrequency',
    required: false,
    enum: ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'],
    description: 'Frecuencia de pago',
    example: 'WEEKLY',
  })
  @ApiQuery({
    name: 'minAmount',
    required: false,
    type: Number,
    description: 'Monto mínimo',
    example: 10000,
  })
  @ApiQuery({
    name: 'maxAmount',
    required: false,
    type: Number,
    description: 'Monto máximo',
    example: 100000,
  })
  @ApiQuery({
    name: 'createdFrom',
    required: false,
    type: String,
    description: 'Fecha de creación desde',
    example: '2024-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'createdTo',
    required: false,
    type: String,
    description: 'Fecha de creación hasta',
    example: '2024-12-31T23:59:59.000Z',
  })
  @ApiResponse({ status: 200, description: 'Préstamos obtenidos exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getAllActiveLoans(@Request() req) {
    const loans = await this.loansService.getAllActiveLoans(req.user.id);

    // Manual transformation to avoid class-transformer issues
    const transformedLoans = loans.map((loan) => {
      const transformedLoan = {
        ...loan,
        // Transform numeric fields manually
        amount: loan.amount ? Number(loan.amount) : loan.amount,
        baseInterestRate: loan.baseInterestRate
          ? Number(loan.baseInterestRate)
          : loan.baseInterestRate,
        penaltyInterestRate: loan.penaltyInterestRate
          ? Number(loan.penaltyInterestRate)
          : loan.penaltyInterestRate,
        originalAmount: loan.originalAmount
          ? Number(loan.originalAmount)
          : loan.originalAmount,
        // Transform subLoans
        subLoans:
          loan.subLoans?.map((subLoan) => ({
            ...subLoan,
            amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
            totalAmount: subLoan.totalAmount
              ? Number(subLoan.totalAmount)
              : subLoan.totalAmount,
            paidAmount: subLoan.paidAmount
              ? Number(subLoan.paidAmount)
              : subLoan.paidAmount,
            payments: subLoan.payments?.map((payment) => ({
              ...payment,
              amount: payment.amount ? Number(payment.amount) : payment.amount,
            })) || [],
          })) || [],
      };
      return transformedLoan;
    });

    return transformedLoans;
  }

  @Get('pagination')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener préstamos paginados del usuario autenticado con filtros avanzados',
    description: 'Obtiene préstamos paginados con soporte para búsqueda parcial por nombre de cliente y filtros por estado y frecuencia de pago.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Número de página',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Elementos por página',
    example: 10,
  })
  @ApiQuery({
    name: 'clientName',
    required: false,
    description: 'Búsqueda parcial por nombre de cliente (mínimo 2 caracteres)',
    example: 'juan',
  })
  @ApiQuery({
    name: 'loanStatus',
    required: false,
    enum: ['ACTIVE', 'COMPLETED', 'ALL'],
    description: 'Filtro por estado. ACTIVE incluye ACTIVE y APPROVED, COMPLETED solo completados, ALL todos',
    example: 'ACTIVE',
  })
  @ApiResponse({
    status: 200,
    description: 'Préstamos paginados obtenidos exitosamente',
    type: PaginatedResponseDto<LoanListResponseDto>,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getPaginatedLoans(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query() filters: LoanFiltersDto,
    @Request() req,
  ) {
    return this.loansService.getAllLoansWithFilters(
      req.user.id,
      req.user.role,
      page,
      limit,
      filters,
    );
  }

  @Get('chart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtener datos de préstamos para gráficos (sin paginación, datos reducidos)',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager',
    example: 'manager_id_here',
  })
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: 'ID del cliente',
    example: 'client_id_here',
  })
  @ApiQuery({
    name: 'loanTrack',
    required: false,
    type: String,
    description: 'Código de tracking del préstamo',
    example: 'LOAN-2024-001',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE'],
    description: 'Estado del préstamo',
    example: 'ACTIVE',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    enum: ['ARS', 'USD'],
    description: 'Moneda del préstamo',
    example: 'ARS',
  })
  @ApiQuery({
    name: 'paymentFrequency',
    required: false,
    enum: ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'],
    description: 'Frecuencia de pago',
    example: 'WEEKLY',
  })
  @ApiQuery({
    name: 'minAmount',
    required: false,
    type: Number,
    description: 'Monto mínimo',
    example: 10000,
  })
  @ApiQuery({
    name: 'maxAmount',
    required: false,
    type: Number,
    description: 'Monto máximo',
    example: 100000,
  })
  @ApiQuery({
    name: 'createdFrom',
    required: false,
    type: String,
    description: 'Fecha de creación desde',
    example: '2024-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'createdTo',
    required: false,
    type: String,
    description: 'Fecha de creación hasta',
    example: '2024-12-31T23:59:59.000Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Datos de préstamos para gráficos obtenidos exitosamente',
    type: [LoanChartDataDto],
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getLoansChart(
    @Query() filters: LoanFiltersDto,
    @Request() req,
  ): Promise<LoanChartDataDto[]> {
    return this.loansService.getLoansChart(req.user.id, req.user.role, filters);
  }

  @Get('today')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener préstamos creados hoy',
    description: 'Devuelve la lista de préstamos creados en la fecha actual con monto prestado, monto total a devolver y nombre del cliente',
  })
  @ApiResponse({
    status: 200,
    description: 'Préstamos de hoy obtenidos exitosamente',
    type: TodayLoansDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayLoans(@Request() req): Promise<TodayLoansDto> {
    return this.loansService.getTodayLoans(req.user.id, req.user.role);
  }

  @Patch(':id/first-due-date')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar fecha del primer vencimiento de un préstamo' })
  @ApiResponse({ status: 200, description: 'Fecha actualizada exitosamente' })
  @ApiResponse({ status: 404, description: 'Préstamo no encontrado' })
  async updateFirstDueDate(
    @Param('id') id: string,
    @Body() dto: UpdateLoanFirstDueDateDto,
    @Request() req,
  ) {
    return this.loansService.updateFirstDueDate(id, req.user.id, dto.firstDueDate);
  }

  @Patch(':id/description')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar descripción/notas de un préstamo' })
  @ApiResponse({ status: 200, description: 'Descripción actualizada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Préstamo no encontrado' })
  async updateDescription(
    @Param('id') id: string,
    @Body() dto: UpdateLoanDescriptionDto,
    @Request() req,
  ) {
    return this.loansService.updateDescription(id, req.user.id, dto.description || '');
  }

  @Get('dashboard-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Stats livianas para el dashboard del prestamista',
    description: 'Retorna loans por semana + distribucion de subloans por status. Sin datos pesados.',
  })
  @ApiResponse({ status: 200, description: 'Stats obtenidas exitosamente' })
  async getDashboardStats(@Request() req) {
    return this.loansService.getDashboardStats(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener un préstamo específico por ID' })
  @ApiResponse({ status: 200, description: 'Préstamo obtenido exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Préstamo no encontrado' })
  async getLoanById(@Param('id') id: string, @Request() req) {
    return this.loansService.getLoanById(id, req.user.id);
  }

  @Delete(':id/permanent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Eliminar permanentemente un préstamo y devolver dinero a la wallet',
    description:
      '⚠️ ACCIÓN IRREVERSIBLE ⚠️ ' +
      'Elimina permanentemente el préstamo y todos sus registros relacionados (subloans, payments, transactions). ' +
      'Devuelve a la wallet del MANAGER el monto completo del préstamo (solo si no hay pagos). ' +
      '🚫 RESTRICCIÓN: Solo se pueden eliminar préstamos que NO tengan ninguna cuota pagada. ' +
      'Si algún subloan fue pagado (total o parcialmente), la eliminación será rechazada. ' +
      'Solo el MANAGER propietario del préstamo puede eliminarlo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Préstamo eliminado y dinero devuelto exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Préstamo eliminado permanentemente' },
        loanTrack: { type: 'string', example: 'LOAN-2025-001' },
        montoDevuelto: { type: 'number', example: 100000 },
        totalPrestamo: { type: 'number', example: 100000 },
        totalPagado: { type: 'number', example: 0 },
        newWalletBalance: { type: 'number', example: 250000 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede eliminar el préstamo porque tiene cuotas que ya fueron pagadas',
  })
  @ApiResponse({ status: 403, description: 'No tienes permisos para eliminar este préstamo' })
  @ApiResponse({ status: 404, description: 'Préstamo o wallet no encontrados' })
  async permanentlyDeleteLoan(@Param('id') id: string, @Request() req) {
    return this.loansService.permanentlyDeleteLoan(id, req.user.id);
  }

  @Get('stats/by-period')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener estadísticas de préstamos nuevos por período',
    description:
      'Retorna el número de préstamos nuevos y monto total agrupados por semana o mes. ' +
      'MANAGER ve sus préstamos, SUBADMIN ve préstamos de sus managers, ADMIN/SUPERADMIN ven todos.',
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
        totalAmount: { type: 'number', example: 5000000 },
        groupBy: { type: 'string', example: 'week' },
        stats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              period: { type: 'string', example: 'Sem. 19/10' },
              count: { type: 'number', example: 5 },
              amount: { type: 'number', example: 500000 },
            },
          },
        },
      },
    },
  })
  async getLoanStatsByPeriod(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy: 'week' | 'month' = 'week',
  ) {
    return this.loansService.getLoanStatsByPeriod(
      req.user.id,
      req.user.role,
      dateFrom,
      dateTo,
      groupBy,
    );
  }

}
