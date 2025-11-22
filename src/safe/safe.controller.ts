import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';
import { SafeService } from './safe.service';
import {
  DepositDto,
  WithdrawDto,
  CreateExpenseDto,
  UpdateExpenseDto,
  TransferToCollectorDto,
  TransferBetweenSafesDto,
  GetHistoryDto,
} from './dto';

@ApiTags('Safe (Caja Fuerte)')
@Controller('safe')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SafeController {
  constructor(private readonly safeService: SafeService) {}

  @Post('deposit')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Depositar fondos en la caja fuerte' })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para depositar en su caja fuerte (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Depósito realizado exitosamente',
  })
  async deposit(
    @CurrentUser() currentUser: any,
    @Body() depositDto: DepositDto,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.deposit(
      targetUserId,
      depositDto.amount,
      depositDto.description,
    );
  }

  @Post('withdraw')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Retirar fondos de la caja fuerte' })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para retirar de su caja fuerte (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Retiro realizado exitosamente',
  })
  async withdraw(
    @CurrentUser() currentUser: any,
    @Body() withdrawDto: WithdrawDto,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.withdraw(
      targetUserId,
      withdrawDto.amount,
      withdrawDto.description,
    );
  }

  @Post('expense')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Crear gasto personalizado',
    description:
      'Crea un gasto personalizado. Si el nombre existe (case-insensitive), reutiliza la categoría. El monto se guarda en la transacción.',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para crear el gasto en su caja fuerte (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Gasto creado exitosamente',
  })
  async createExpense(
    @CurrentUser() currentUser: any,
    @Body() createExpenseDto: CreateExpenseDto,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.createExpense(
      targetUserId,
      createExpenseDto.name,
      createExpenseDto.amount,
      createExpenseDto.description,
    );
  }

  @Post('transfer-to-collector')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Transferir fondos de la caja fuerte a la wallet de cobros',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para transferir desde su caja fuerte (solo para SUBADMIN/ADMIN)',
    example: 'cmhzf5hg3000zgxbxxh445qzl',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Transferencia realizada exitosamente',
  })
  async transferToCollector(
    @CurrentUser() currentUser: any,
    @Body() transferDto: TransferToCollectorDto,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.transferToCollectorWallet(
      targetUserId,
      transferDto.amount,
      transferDto.description,
    );
  }

  @Post('transfer-between-safes')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Transferir fondos entre cajas fuertes',
    description: 'Transfiere fondos de tu caja fuerte (o de un manager si se especifica managerId) a la caja fuerte de otro manager',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager desde cuya caja fuerte se transfiere (solo para SUBADMIN/ADMIN). Si no se especifica, se transfiere desde la caja fuerte del usuario autenticado.',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Transferencia realizada exitosamente',
  })
  async transferBetweenSafes(
    @CurrentUser() currentUser: any,
    @Body() transferDto: TransferBetweenSafesDto,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo como origen
    let fromUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      fromUserId = managerId;
    }

    return this.safeService.transferBetweenSafes(
      fromUserId,
      transferDto.targetManagerId,
      transferDto.amount,
      transferDto.description,
    );
  }

  @Get('balance')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Obtener balance actual de la caja fuerte' })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para consultar su balance (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Balance obtenido exitosamente',
  })
  async getBalance(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.getBalance(targetUserId);
  }

  @Post('expenses')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Crear categoría de gasto',
    description: 'Crea una nueva categoría de gasto (solo nombre y descripción, sin monto ni transacción)',
  })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para crear la categoría en su SUBADMIN (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Categoría creada exitosamente',
  })
  async createExpenseCategory(
    @CurrentUser() currentUser: any,
    @Body() createExpenseDto: { name: string; description?: string },
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.createExpenseCategory(
      targetUserId,
      createExpenseDto.name,
      createExpenseDto.description,
    );
  }

  @Get('expenses')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Listar todos los gastos guardados' })
  @ApiQuery({
    name: 'managerId',
    required: false,
    type: String,
    description: 'ID del manager para consultar las categorías de su SUBADMIN (solo para SUBADMIN/ADMIN)',
    example: 'cmi9bfiwh004dgxcljcv071x3',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Gastos obtenidos exitosamente',
  })
  async getExpenses(
    @CurrentUser() currentUser: any,
    @Query('managerId') managerId?: string,
  ) {
    // Si se proporciona managerId, validar acceso y usarlo
    let targetUserId = currentUser.id;
    if (managerId) {
      // Validar acceso al manager
      await this.safeService.validateManagerAccess(managerId, currentUser);
      targetUserId = managerId;
    }

    return this.safeService.getExpenses(targetUserId);
  }

  @Get('expenses/:id')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Obtener un gasto específico por ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Gasto obtenido exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Gasto no encontrado',
  })
  async getExpenseById(
    @CurrentUser() currentUser: any,
    @Param('id') expenseId: string,
  ) {
    return this.safeService.getExpenseById(currentUser.id, expenseId);
  }

  @Put('expenses/:id')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Actualizar un gasto existente' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Gasto actualizado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Gasto no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Ya existe un gasto con ese nombre',
  })
  async updateExpense(
    @CurrentUser() currentUser: any,
    @Param('id') expenseId: string,
    @Body() updateExpenseDto: UpdateExpenseDto,
  ) {
    return this.safeService.updateExpense(
      currentUser.id,
      expenseId,
      updateExpenseDto,
    );
  }

  @Delete('expenses/:id')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Eliminar un gasto' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Gasto eliminado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Gasto no encontrado',
  })
  async deleteExpense(
    @CurrentUser() currentUser: any,
    @Param('id') expenseId: string,
  ) {
    return this.safeService.deleteExpense(currentUser.id, expenseId);
  }

  @Get('history')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Obtener historial de transacciones de la caja fuerte',
    description: 'Historial paginado con filtros por fecha y tipo',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historial obtenido exitosamente',
  })
  async getHistory(
    @CurrentUser() currentUser: any,
    @Query() query: GetHistoryDto,
  ) {
    return this.safeService.getHistory(
      currentUser.id,
      query.page || 1,
      query.limit || 50,
      query.startDate,
      query.endDate,
      query.type,
      query.managerId,
      currentUser,
    );
  }
}

