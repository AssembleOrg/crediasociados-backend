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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CollectorWalletService } from './collector-wallet.service';
import {
  WithdrawDto,
  GetTransactionsDto,
  PeriodReportDto,
  DailySummaryDto,
  TodayCollectionsDto,
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
      'Retorna el balance actual de la wallet de cobros del cobrador autenticado',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Balance obtenido exitosamente',
  })
  async getBalance(@CurrentUser() currentUser: any) {
    return this.collectorWalletService.getBalance(currentUser.id);
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
}

