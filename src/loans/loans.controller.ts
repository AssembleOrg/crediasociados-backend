import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { LoansService } from './loans.service';
import {
  CreateLoanDto,
  LoanTrackingResponseDto,
  CreateLoanResponseDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { Public } from '../common/decorators/public.decorator';

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
    return this.loansService.createLoan(createLoanDto, req.user.id);
  }

  @Get('tracking')
  @Public()
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
    summary: 'Obtener todos los préstamos del usuario autenticado',
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
  @ApiResponse({ status: 200, description: 'Préstamos obtenidos exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getAllLoans(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Request() req,
  ) {
    return this.loansService.getAllLoans(req.user.id, page, limit);
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
}
