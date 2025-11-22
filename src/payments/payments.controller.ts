import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { RegisterPaymentDto, BulkPaymentDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('register')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Registrar un pago para un SubLoan',
    description:
      'Registra un pago que puede ser parcial, exacto o con excedente. ' +
      'Los excedentes se distribuyen automáticamente a SubLoans anteriores PARTIAL.',
  })
  @ApiResponse({
    status: 201,
    description: 'Pago registrado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o SubLoan ya pagado',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes acceso a este SubLoan',
  })
  @ApiResponse({
    status: 404,
    description: 'SubLoan no encontrado',
  })
  async registerPayment(
    @Request() req: any,
    @Body() registerPaymentDto: RegisterPaymentDto,
  ) {
    return this.paymentsService.registerPayment(
      req.user.id,
      req.user.role,
      registerPaymentDto,
    );
  }

  @Post('bulk-register')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Registrar múltiples pagos a la vez',
    description: 'Permite registrar varios pagos en una sola operación.',
  })
  @ApiResponse({
    status: 201,
    description: 'Pagos procesados',
  })
  async registerBulkPayments(
    @Request() req: any,
    @Body() bulkPaymentDto: BulkPaymentDto,
  ) {
    return this.paymentsService.registerBulkPayments(
      req.user.id,
      req.user.role,
      bulkPaymentDto,
    );
  }

  @Get('subloan/:subLoanId')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener historial de pagos de un SubLoan',
    description:
      'Retorna todos los pagos realizados a un SubLoan y su historial completo.',
  })
  @ApiParam({
    name: 'subLoanId',
    description: 'ID del SubLoan',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Historial obtenido exitosamente',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes acceso a este SubLoan',
  })
  @ApiResponse({
    status: 404,
    description: 'SubLoan no encontrado',
  })
  async getSubLoanPayments(
    @Request() req: any,
    @Param('subLoanId') subLoanId: string,
  ) {
    return this.paymentsService.getSubLoanPayments(
      subLoanId,
      req.user.id,
      req.user.role,
    );
  }

  @Put('subloan/:subLoanId/edit')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Editar el pago de un SubLoan',
    description:
      'Edita el pago de un SubLoan que esté completamente pagado. ' +
      'Revierte todos los pagos anteriores y aplica el nuevo pago como si fuera el primero. ' +
      'Recalcula automáticamente la distribución de excedentes y actualiza todas las wallets.',
  })
  @ApiParam({
    name: 'subLoanId',
    description: 'ID del SubLoan cuyo pago se desea editar',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Pago editado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o SubLoan no está completamente pagado',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes acceso a este SubLoan',
  })
  @ApiResponse({
    status: 404,
    description: 'SubLoan no encontrado',
  })
  async editPayment(
    @Request() req: any,
    @Param('subLoanId') subLoanId: string,
    @Body() editPaymentDto: Omit<RegisterPaymentDto, 'subLoanId'>,
  ) {
    return this.paymentsService.editPayment(
      req.user.id,
      req.user.role,
      subLoanId,
      editPaymentDto,
    );
  }

  @Delete('subloan/:subLoanId/reset')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Resetear todos los pagos de un SubLoan',
    description:
      'Elimina todos los pagos de un SubLoan y revierte sus efectos en las wallets. ' +
      'Solo se permite si el último pago fue hace menos de 24 horas. ' +
      'Registra el movimiento en el historial de pagos.',
  })
  @ApiParam({
    name: 'subLoanId',
    description: 'ID del SubLoan cuyos pagos se desean resetear',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Pagos reseteados exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'El último pago fue hace más de 24 horas o no hay pagos para resetear',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes acceso a este SubLoan',
  })
  @ApiResponse({
    status: 404,
    description: 'SubLoan no encontrado',
  })
  async resetSubLoanPayments(
    @Request() req: any,
    @Param('subLoanId') subLoanId: string,
  ) {
    return this.paymentsService.resetSubLoanPayments(
      subLoanId,
      req.user.id,
      req.user.role,
    );
  }
}
