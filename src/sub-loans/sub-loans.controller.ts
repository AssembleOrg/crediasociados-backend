import {
  Controller,
  Get,
  UseGuards,
  Request,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { SubLoansService } from './sub-loans.service';

@ApiTags('SubLoans')
@Controller('sub-loans')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SubLoansController {
  constructor(private readonly subLoansService: SubLoansService) {}

  @Get('today-due')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener subloans que vencen hoy (paginado)',
    description:
      'Retorna todos los subloans que tienen fecha de vencimiento hoy (cualquier estado) con paginación',
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
    description: 'Elementos por página (mínimo 20)',
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: 'Subloans que vencen hoy obtenidos exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayDueSubLoans(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    const result = await this.subLoansService.getTodayDueSubLoans(
      req.user.id,
      page,
      limit,
    );

    // Manual transformation to avoid class-transformer issues
    const transformedSubLoans = result.data.map((subLoan) => ({
      ...subLoan,
      // Transform numeric fields manually
      amount: subLoan.amount ? Number(subLoan.amount) : subLoan.amount,
      totalAmount: subLoan.totalAmount
        ? Number(subLoan.totalAmount)
        : subLoan.totalAmount,
      paidAmount: subLoan.paidAmount
        ? Number(subLoan.paidAmount)
        : subLoan.paidAmount,
      loan: {
        ...subLoan.loan,
        // Transform loan numeric fields
        amount: subLoan.loan.amount
          ? Number(subLoan.loan.amount)
          : subLoan.loan.amount,
        baseInterestRate: subLoan.loan.baseInterestRate
          ? Number(subLoan.loan.baseInterestRate)
          : subLoan.loan.baseInterestRate,
        penaltyInterestRate: subLoan.loan.penaltyInterestRate
          ? Number(subLoan.loan.penaltyInterestRate)
          : subLoan.loan.penaltyInterestRate,
        originalAmount: subLoan.loan.originalAmount
          ? Number(subLoan.loan.originalAmount)
          : subLoan.loan.originalAmount,
      },
    }));

    return {
      data: transformedSubLoans,
      meta: result.meta,
    };
  }

  @Get('today-due/stats')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener estadísticas de subloans que vencen hoy',
    description:
      'Retorna estadísticas agrupadas por status de los subloans que vencen hoy',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getTodayDueSubLoansStats(@Request() req) {
    const stats = await this.subLoansService.getTodayDueSubLoansStats(
      req.user.id,
    );

    // Transform numeric fields in stats
    const transformedStats = stats.map((stat) => ({
      ...stat,
      _sum: {
        amount: stat._sum.amount ? Number(stat._sum.amount) : stat._sum.amount,
        totalAmount: stat._sum.totalAmount
          ? Number(stat._sum.totalAmount)
          : stat._sum.totalAmount,
      },
    }));

    return transformedStats;
  }

  @Post('activate-today-due')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Activar subloans que vencen hoy',
    description:
      'Cambia el status de subloans pendientes que vencen hoy a OVERDUE (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Subloans activados exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async activateTodayDueSubLoans() {
    const result = await this.subLoansService.activateTodayDueSubLoans();
    return result;
  }
}
