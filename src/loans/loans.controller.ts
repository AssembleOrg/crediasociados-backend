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
import { Type, plainToClass } from 'class-transformer';
import { LoansService } from './loans.service';
import {
  CreateLoanDto,
  LoanTrackingResponseDto,
  CreateLoanResponseDto,
  LoanListResponseDto,
} from './dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
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
    const result = await this.loansService.createLoan(createLoanDto, req.user.id);
    
    if (!result) {
      throw new BadRequestException('Error al crear el préstamo');
    }
    
    // Manual transformation to avoid class-transformer issues
    const transformedResult = {
      ...result,
      // Transform numeric fields manually
      amount: result.amount ? Number(result.amount) : result.amount,
      baseInterestRate: result.baseInterestRate ? Number(result.baseInterestRate) : result.baseInterestRate,
      penaltyInterestRate: result.penaltyInterestRate ? Number(result.penaltyInterestRate) : result.penaltyInterestRate,
      originalAmount: result.originalAmount ? Number(result.originalAmount) : result.originalAmount,
      // Transform subLoans
      subLoans: result.subLoans?.map(subLoan => ({
        ...subLoan,
        amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
        totalAmount: subLoan.totalAmount ? Number(subLoan.totalAmount) : subLoan.totalAmount,
        paidAmount: subLoan.paidAmount ? Number(subLoan.paidAmount) : subLoan.paidAmount,
      })) || []
    };
    
    return transformedResult;
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
    summary: 'Obtener todos los préstamos activos del usuario autenticado',
  })
  @ApiResponse({
    status: 200,
    description: 'Préstamos activos obtenidos exitosamente',
    type: [LoanListResponseDto]
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getAllActiveLoans(@Request() req) {
    const loans = await this.loansService.getAllActiveLoans(req.user.id);
    
    // Manual transformation to avoid class-transformer issues
    const transformedLoans = loans.map(loan => {
      const transformedLoan = {
        ...loan,
        // Transform numeric fields manually
        amount: loan.amount ? Number(loan.amount) : loan.amount,
        baseInterestRate: loan.baseInterestRate ? Number(loan.baseInterestRate) : loan.baseInterestRate,
        penaltyInterestRate: loan.penaltyInterestRate ? Number(loan.penaltyInterestRate) : loan.penaltyInterestRate,
        originalAmount: loan.originalAmount ? Number(loan.originalAmount) : loan.originalAmount,
        // Transform subLoans
        subLoans: loan.subLoans?.map(subLoan => ({
          ...subLoan,
          amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
          totalAmount: subLoan.totalAmount ? Number(subLoan.totalAmount) : subLoan.totalAmount,
          paidAmount: subLoan.paidAmount ? Number(subLoan.paidAmount) : subLoan.paidAmount,
        })) || []
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
    summary: 'Obtener préstamos paginados del usuario autenticado',
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
  @ApiResponse({
    status: 200,
    description: 'Préstamos paginados obtenidos exitosamente',
    type: PaginatedResponseDto<LoanListResponseDto>
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getPaginatedLoans(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Request() req,
  ) {
    const result = await this.loansService.getAllLoans(req.user.id, page, limit);
    
    // Manual transformation to avoid class-transformer issues
    const transformedLoans = result.data.map(loan => {
      const transformedLoan = {
        ...loan,
        // Transform numeric fields manually
        amount: loan.amount ? Number(loan.amount) : loan.amount,
        baseInterestRate: loan.baseInterestRate ? Number(loan.baseInterestRate) : loan.baseInterestRate,
        penaltyInterestRate: loan.penaltyInterestRate ? Number(loan.penaltyInterestRate) : loan.penaltyInterestRate,
        originalAmount: loan.originalAmount ? Number(loan.originalAmount) : loan.originalAmount,
        // Transform subLoans
        subLoans: loan.subLoans?.map(subLoan => ({
          ...subLoan,
          amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
          totalAmount: subLoan.totalAmount ? Number(subLoan.totalAmount) : subLoan.totalAmount,
          paidAmount: subLoan.paidAmount ? Number(subLoan.paidAmount) : subLoan.paidAmount,
        })) || []
      };
      return transformedLoan;
    });
    
    return {
      data: transformedLoans,
      meta: result.meta
    };
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
