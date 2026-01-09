import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CollectorWalletService } from './collector-wallet.service';
import {
  WithdrawDto,
  WithdrawManagerDto,
  GetTransactionsDto,
  GetCompleteHistoryDto,
  ManagerDetailDto,
  CollectionsSummaryDto,
  PeriodReportDto,
  DailySummaryDto,
  TodayCollectionsDto,
  WalletHistoryDto,
  CashAdjustmentDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DateUtil } from '../common/utils/date.util';

@ApiTags('Collector Wallet')
@ApiBearerAuth()
@Controller('collector-wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectorWalletController {
  constructor(private readonly collectorWalletService: CollectorWalletService) {}

  @Get('balance')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener balance de la wallet de cobros',
    description:
      'Retorna el balance actual de la wallet de cobros. ' +
      'Para MANAGER: devuelve su propio balance. ' +
      'Para SUBADMIN: devuelve el balance agregado de todos sus managers.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Balance obtenido exitosamente',
  })
  async getBalance(@CurrentUser() currentUser: any) {
    return this.collectorWalletService.getBalance(
      currentUser.id,
      currentUser.role,
    );
  }

  @Get('managers-balances')
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener balances de wallets de cobros de todos los managers',
    description:
      'Retorna la lista de managers con sus balances de wallets de cobros. ' +
      'Para SUBADMIN: solo muestra sus managers. ' +
      'Para ADMIN/SUPERADMIN: muestra todos los managers.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Balances obtenidos exitosamente',
  })
  async getManagersBalances(@CurrentUser() currentUser: any) {
    return this.collectorWalletService.getManagersBalances(
      currentUser.id,
      currentUser.role,
    );
  }

  @Get('summary')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener resumen completo de la wallet',
    description:
      'Retorna balance actual y estadísticas de cobros y retiros del cobrador',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen obtenido exitosamente',
  })
  async getSummary(@CurrentUser() currentUser: any) {
    return this.collectorWalletService.getSummary(currentUser.id);
  }

  @Get('transactions')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener historial de transacciones',
    description:
      'Retorna el historial paginado de cobros y retiros de la wallet del cobrador',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transacciones obtenidas exitosamente',
  })
  async getTransactions(
    @CurrentUser() currentUser: any,
    @Query() query: GetTransactionsDto,
  ) {
    return this.collectorWalletService.getTransactions(
      currentUser.id,
      query.page,
      query.limit,
      query.type,
    );
  }

  @Get('last-withdrawal')
  @Roles(UserRole.MANAGER, UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener el último retiro realizado',
    description:
      'Retorna los datos del último retiro de la wallet de cobros. ' +
      'Para MANAGER: devuelve su último retiro (puede pasar su managerId o no). ' +
      'Para SUBADMIN: puede pasar un managerId opcional para obtener el último retiro de un manager específico. ' +
      'Si no se pasa managerId, SUBADMIN obtiene el último retiro de cualquiera de sus managers.',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager. Opcional. Para SUBADMIN: permite especificar un manager. Para MANAGER: debe ser su propio ID.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Último retiro obtenido exitosamente. Retorna null si no hay retiros.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'No tienes permiso para acceder a este manager',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Manager no encontrado',
  })
  async getLastWithdrawal(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId?: string,
  ) {
    return this.collectorWalletService.getLastWithdrawal(
      currentUser.id,
      currentUser.role,
      managerId,
    );
  }

  @Post('withdraw')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Realizar un retiro de la wallet de cobros',
    description:
      'Permite al cobrador retirar fondos de su wallet. Valida que el saldo nunca quede negativo.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Retiro realizado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Saldo insuficiente o monto inválido',
  })
  async withdraw(
    @CurrentUser() currentUser: any,
    @Body() withdrawDto: WithdrawDto,
  ) {
    return this.collectorWalletService.withdraw(
      currentUser.id,
      withdrawDto.amount,
      withdrawDto.description,
    );
  }

  @Post('cash-adjustment')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Ajuste de caja: Ingresar dinero a la wallet de cobros',
    description:
      'Permite al SUBADMIN ingresar dinero a la wallet de cobros de un manager desde su propia wallet. ' +
      'Se utiliza para cuadreo de caja negativo. El dinero se debita de la wallet del SUBADMIN y se acredita a la collector wallet del manager. ' +
      'Solo SUBADMIN puede realizar esta operación y solo para managers que él creó.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Ajuste de caja realizado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Monto inválido o manager no válido',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Solo SUBADMIN puede realizar ajustes de caja',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Manager o wallet no encontrada',
  })
  async cashAdjustment(
    @CurrentUser() currentUser: any,
    @Body() cashAdjustmentDto: CashAdjustmentDto,
  ) {
    return this.collectorWalletService.cashAdjustment(
      currentUser.id,
      cashAdjustmentDto.managerId,
      cashAdjustmentDto.amount,
      cashAdjustmentDto.description,
    );
  }

  @Post('withdraw-manager')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Retirar dinero de la wallet de cobros de un manager',
    description:
      'Permite al SUBADMIN retirar dinero de la wallet de cobros de un manager. ' +
      'Solo SUBADMIN puede realizar esta operación y solo para managers que él creó. ' +
      'El managerId se pasa como query parameter. ' +
      'La wallet puede quedar con saldo negativo.',
  })
  @ApiQuery({
    name: 'managerId',
    required: true,
    description: 'ID del manager del cual se retirará de su wallet de cobros',
    example: 'cmhzpk25e0008gx4bllhe9i5t',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Retiro realizado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Monto inválido, managerId requerido o manager no válido',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Solo SUBADMIN puede retirar de wallets de managers que él creó',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Manager o wallet no encontrada',
  })
  async withdrawFromManager(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId: string,
    @Body() withdrawManagerDto: WithdrawManagerDto,
  ) {
    if (!managerId) {
      throw new BadRequestException('managerId es requerido como query parameter');
    }

    return this.collectorWalletService.withdrawFromManager(
      currentUser.id,
      managerId,
      withdrawManagerDto.amount,
      withdrawManagerDto.description,
    );
  }

  @Get('period-report')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener reporte detallado del período',
    description:
      'Retorna un reporte completo del período incluyendo: historial de wallet de cobros, ' +
      'cobros realizados con porcentajes, retiros, gastos y comisión calculada automáticamente. ' +
      'Si no se proporcionan fechas, usa la semana actual (lunes a domingo). ' +
      'ADMIN y SUBADMIN pueden especificar managerId para ver reportes de otros managers.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reporte generado exitosamente',
  })
  async getPeriodReport(
    @CurrentUser() currentUser: any,
    @Query() query: PeriodReportDto,
  ) {
    const startDate = query.startDate ? DateUtil.parseToDate(query.startDate) : undefined;
    const endDate = query.endDate ? DateUtil.parseToDate(query.endDate) : undefined;

    // Determinar el usuario objetivo
    let targetUserId = currentUser.id;
    let managerIdToPass: string | undefined;

    if (query.managerId) {
      // Validar permisos para ver otros managers
      if (currentUser.role === UserRole.MANAGER) {
        throw new ForbiddenException('No tienes permisos para ver reportes de otros managers');
      }

      // Para SUBADMIN y ADMIN/SUPERADMIN, validar que el manager exista
      const targetUser = await this.collectorWalletService['prisma'].user.findUnique({
        where: { id: query.managerId },
        select: { createdById: true, role: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Manager no encontrado');
      }

      // Para SUBADMIN, adicionalmente validar que el manager sea suyo
      if (currentUser.role === UserRole.SUBADMIN && targetUser.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver el reporte de managers que tú creaste',
        );
      }

      targetUserId = query.managerId;
      managerIdToPass = query.managerId;
    }

    return this.collectorWalletService.getPeriodReport(
      currentUser.id,
      startDate,
      endDate,
      managerIdToPass,
    );
  }

  @Get('daily-summary')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Obtener resumen diario propio (MANAGER)',
    description:
      'Retorna el resumen del día actual del manager autenticado. ' +
      'Incluye: cobrado, prestado y gastos. Horario: 00:00 a 23:59 GMT-3.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen diario obtenido exitosamente',
  })
  async getMyDailySummary(@CurrentUser() currentUser: any) {
    return this.collectorWalletService.getDailySummary(currentUser.id);
  }

  @Get('daily-summary/query')
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener resumen diario de cualquier manager (SUBADMIN)',
    description:
      'Retorna el resumen de un día específico de un manager. ' +
      'Incluye: cobrado, prestado y gastos. Horario: 00:00 a 23:59 GMT-3. ' +
      'Si no se proporciona fecha, usa el día actual. ' +
      'Si no se proporciona managerId, usa el usuario autenticado.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen diario obtenido exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'No tienes permisos para ver este manager',
  })
  async getDailySummaryByQuery(
    @CurrentUser() currentUser: any,
    @Query() query: DailySummaryDto,
  ) {
    const targetUserId = query.managerId || currentUser.id;
    
    // Si es SUBADMIN, validar que el manager sea suyo
    if (currentUser.role === UserRole.SUBADMIN) {
      const targetUser = await this.collectorWalletService['prisma'].user.findUnique({
        where: { id: targetUserId },
        select: { createdById: true, role: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (targetUser.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver el resumen de managers que tú creaste',
        );
      }
    }

    const date = query.date ? new Date(query.date) : undefined;
    return this.collectorWalletService.getDailySummary(targetUserId, date);
  }

  @Get('today/collections')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener cobros realizados hoy',
    description: 'Devuelve la lista de cobros realizados en la fecha actual con monto, información del usuario que cobró y descripción',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cobros de hoy obtenidos exitosamente',
    type: TodayCollectionsDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayCollections(@CurrentUser() currentUser: any): Promise<TodayCollectionsDto> {
    return this.collectorWalletService.getTodayCollections(
      currentUser.id,
      currentUser.role,
    );
  }

  @Get('complete-history')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener historial completo paginado de todos los movimientos financieros',
    description:
      'Devuelve todos los movimientos financieros que afectan la wallet de cobros: ' +
      'cobros, retiros, gastos de ruta, préstamos y ajustes de caja. ' +
      'Requiere managerId como query parameter. ' +
      'Por defecto devuelve 50 movimientos por página ordenados por fecha descendente. ' +
      'Permite filtrado por tipo de transacción y fechas. ' +
      'Las fechas se interpretan en zona horaria de Buenos Aires (GMT-3).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historial obtenido exitosamente',
  })
  @ApiResponse({ status: 400, description: 'managerId es requerido o parámetros inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos para ver este historial' })
  async getCompleteHistory(
    @CurrentUser() currentUser: any,
    @Query() query: GetCompleteHistoryDto,
  ) {
    const managerId = query.managerId;

    // Validar permisos
    if (currentUser.role === UserRole.MANAGER && currentUser.id !== managerId) {
      throw new ForbiddenException(
        'Solo puedes ver el historial de tu propia wallet',
      );
    }

    if (currentUser.role === UserRole.SUBADMIN) {
      // Validar que el manager sea del SUBADMIN
      const manager = await this.collectorWalletService['prisma'].user.findUnique({
        where: { id: managerId },
        select: { createdById: true, role: true },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (manager.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver el historial de managers que tú creaste',
        );
      }
    }

    const pageNumber = query.page || 1;
    const limitNumber = query.limit || 50;

    return this.collectorWalletService.getCompleteHistory(
      managerId,
      pageNumber,
      limitNumber,
      {
        type: query.type,
        startDate: query.startDate,
        endDate: query.endDate,
      },
    );
  }

  @Get('manager-detail')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener información detallada del manager',
    description:
      'Devuelve información completa del manager incluyendo: nombre, email, cuota de clientes, ' +
      'clientes actuales, dinero en calle (monto prestado + intereses no cobrados), ' +
      'y todos los préstamos con sus subpréstamos y estados de cuotas. ' +
      'Útil para mostrar en un popup al hacer click en un botón.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Información del manager obtenida exitosamente',
  })
  @ApiResponse({ status: 400, description: 'managerId es requerido o parámetros inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos para ver esta información' })
  @ApiResponse({ status: 404, description: 'Manager no encontrado' })
  async getManagerDetail(
    @CurrentUser() currentUser: any,
    @Query() query: ManagerDetailDto,
  ) {
    const managerId = query.managerId;

    // Validar permisos
    if (currentUser.role === UserRole.MANAGER && currentUser.id !== managerId) {
      throw new ForbiddenException(
        'Solo puedes ver tu propia información',
      );
    }

    if (currentUser.role === UserRole.SUBADMIN) {
      // Validar que el manager sea del SUBADMIN
      const manager = await this.collectorWalletService['prisma'].user.findUnique({
        where: { id: managerId },
        select: { createdById: true, role: true },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (manager.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver la información de managers que tú creaste',
        );
      }
    }

    return this.collectorWalletService.getManagerDetail(managerId);
  }

  @Get('collections-summary')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener sumatoria de cobros en un rango de fechas',
    description:
      'Devuelve la sumatoria neta de todos los cobros realizados a subpréstamos ' +
      'en un rango de fechas para un manager específico. ' +
      'Incluye transacciones de tipo COLLECTION y PAYMENT_RESET (los reseteos se restan automáticamente). ' +
      'Las fechas deben estar en formato DD/MM/YYYY y se interpretan en zona horaria de Buenos Aires (GMT-3).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen de cobros obtenido exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos o fechas incorrectas' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos para ver esta información' })
  @ApiResponse({ status: 404, description: 'Manager no encontrado' })
  async getCollectionsSummary(
    @CurrentUser() currentUser: any,
    @Query() query: CollectionsSummaryDto,
  ) {
    const managerId = query.managerId;

    // Validar permisos
    if (currentUser.role === UserRole.MANAGER && currentUser.id !== managerId) {
      throw new ForbiddenException(
        'Solo puedes ver tu propia información',
      );
    }

    if (currentUser.role === UserRole.SUBADMIN) {
      // Validar que el manager sea del SUBADMIN
      const manager = await this.collectorWalletService['prisma'].user.findUnique({
        where: { id: managerId },
        select: { createdById: true, role: true },
      });

      if (!manager) {
        throw new NotFoundException('Manager no encontrado');
      }

      if (manager.createdById !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes ver la información de managers que tú creaste',
        );
      }
    }

    return this.collectorWalletService.getCollectionsSummary(
      managerId,
      query.startDate,
      query.endDate,
    );
  }

  @Get('history')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Obtener historial completo de movimientos de wallet de cobros',
    description: 'Devuelve todos los movimientos (cobros y retiros) de la wallet de cobros sin paginación. MANAGER ve solo sus movimientos, SUBADMIN ve movimientos de sus managers, ADMIN/SUPERADMIN ven todos.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historial obtenido exitosamente',
    type: WalletHistoryDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getWalletHistory(@CurrentUser() currentUser: any): Promise<WalletHistoryDto> {
    return this.collectorWalletService.getAllWalletHistory(
      currentUser.id,
      currentUser.role,
    );
  }

  @Get('track-loan-disbursements')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Trackear transacciones LOAN_DISBURSEMENT para detectar discrepancias',
    description:
      'Obtiene todas las transacciones LOAN_DISBURSEMENT y verifica si el préstamo asociado aún existe. ' +
      'Útil para detectar préstamos eliminados (hard delete) que dejaron transacciones huérfanas. ' +
      'Solo para ADMIN y SUPERADMIN.',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para filtrar (opcional). Si no se proporciona, muestra todos.',
    example: 'cmjop3g5s01czs10we17udzbu',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Análisis de transacciones LOAN_DISBURSEMENT',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  async trackLoanDisbursements(@Query('managerId') managerId?: string) {
    return this.collectorWalletService.trackLoanDisbursements(managerId);
  }

  @Post('create-missing-reversals')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Crear transacciones de reversión para préstamos eliminados sin reversión',
    description:
      'Busca préstamos eliminados que no tienen transacción de reversión y las crea. ' +
      'Esto corrige el balance y hace visible la reversión en el historial. ' +
      'Solo para ADMIN y SUPERADMIN.',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para filtrar (opcional). Si no se proporciona, procesa todos.',
    example: 'cmjop3g5s01czs10we17udzbu',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reversiones creadas exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  async createMissingReversals(@Query('managerId') managerId?: string) {
    return this.collectorWalletService.createMissingReversalTransactions(managerId);
  }
}

