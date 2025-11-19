import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { DepositDto, WithdrawalDto, TransferDto, GetTransactionsDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, WalletTransactionType } from '../common/enums';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('my-wallet')
  @Roles(UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener cartera del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Cartera obtenida exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Cartera no encontrada',
  })
  async getMyWallet(@CurrentUser() currentUser: any) {
    return this.walletService.getUserWallet(currentUser.id);
  }

  @Post('deposit')
  @Roles(UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Realizar un depósito en la cartera' })
  @ApiResponse({
    status: 201,
    description: 'Depósito realizado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos',
  })
  async deposit(@CurrentUser() currentUser: any, @Body() depositDto: DepositDto) {
    return this.walletService.deposit(currentUser.id, depositDto);
  }

  @Post('withdrawal')
  @Roles(UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Realizar un retiro de la cartera' })
  @ApiResponse({
    status: 201,
    description: 'Retiro realizado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Saldo insuficiente o datos inválidos',
  })
  async withdrawal(@CurrentUser() currentUser: any, @Body() withdrawalDto: WithdrawalDto) {
    return this.walletService.withdrawal(currentUser.id, withdrawalDto);
  }

  @Post('transfer')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Transferir dinero hacia/desde un manager',
    description:
      'Permite transferir fondos entre SUBADMIN y MANAGER. ' +
      'Monto positivo: SUBADMIN → MANAGER. ' +
      'Monto negativo: MANAGER → SUBADMIN (retiro de fondos). ' +
      'El saldo de ninguna cartera puede quedar negativo.',
  })
  @ApiResponse({
    status: 201,
    description: 'Transferencia realizada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Saldo insuficiente o datos inválidos',
  })
  @ApiResponse({
    status: 403,
    description: 'Solo SUBADMIN puede realizar transferencias',
  })
  async transfer(@CurrentUser() currentUser: any, @Body() transferDto: TransferDto) {
    return this.walletService.transfer(currentUser.id, transferDto);
  }

  @Get('transactions')
  @Roles(UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ 
    summary: 'Obtener historial de transacciones de la cartera',
    description: 'Obtiene el historial paginado de transacciones. Las fechas se interpretan en zona horaria de Buenos Aires (GMT-3). startDate usa el inicio del día (00:00:00) y endDate usa el final del día (23:59:59).',
  })
  @ApiResponse({
    status: 200,
    description: 'Transacciones obtenidas exitosamente',
  })
  async getTransactions(
    @CurrentUser() currentUser: any,
    @Query() query: GetTransactionsDto,
  ) {
    return this.walletService.getTransactions(currentUser.id, {
      page: query.page,
      limit: query.limit,
    }, {
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get('balance')
  @Roles(UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener saldo disponible' })
  @ApiResponse({
    status: 200,
    description: 'Saldo obtenido exitosamente',
  })
  async getBalance(@CurrentUser() currentUser: any) {
    return this.walletService.getBalance(currentUser.id);
  }
}
