import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
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
import { DailyClosureService } from './daily-closure.service';
import { CreateClosureDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('daily-closures')
@ApiBearerAuth()
@Controller('daily-closures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyClosureController {
  constructor(private readonly dailyClosureService: DailyClosureService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Crear un cierre diario',
    description:
      'Crea un cierre diario con los cobros realizados y gastos incurridos. ' +
      'Calcula automáticamente el monto neto.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cierre creado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Ya existe un cierre para esa fecha o datos inválidos',
  })
  @ApiResponse({
    status: 403,
    description: 'Solo los MANAGER pueden crear cierres',
  })
  async createClosure(
    @Request() req: any,
    @Body() createClosureDto: CreateClosureDto,
  ) {
    return this.dailyClosureService.createClosure(
      req.user.id,
      req.user.role,
      createClosureDto,
    );
  }

  @Get('my-closures')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Obtener cierres del manager autenticado',
    description: 'Retorna los cierres diarios del manager con paginación.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Fecha desde (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Fecha hasta (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cierres obtenidos exitosamente',
  })
  async getMyClosure(
    @Request() req: any,
    @Query() paginationDto: PaginationDto,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dailyClosureService.getMyClosure(req.user.id, paginationDto, {
      startDate,
      endDate,
    });
  }

  @Get(':id')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener detalle de un cierre por ID',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del cierre',
  })
  @ApiResponse({
    status: 200,
    description: 'Cierre obtenido exitosamente',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes acceso a este cierre',
  })
  @ApiResponse({
    status: 404,
    description: 'Cierre no encontrado',
  })
  async getClosureById(@Request() req: any, @Param('id') id: string) {
    return this.dailyClosureService.getClosureById(
      id,
      req.user.id,
      req.user.role,
    );
  }

  @Get('date/:date')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener cierre por fecha específica',
    description:
      'Retorna el cierre de una fecha específica junto con los SubLoans que vencían ese día.',
  })
  @ApiParam({
    name: 'date',
    description: 'Fecha del cierre (YYYY-MM-DD)',
    example: '2024-01-15',
  })
  @ApiResponse({
    status: 200,
    description: 'Cierre y SubLoans obtenidos exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'No hay cierre para esa fecha',
  })
  async getClosureByDate(@Request() req: any, @Param('date') date: string) {
    return this.dailyClosureService.getClosureByDate(
      date,
      req.user.id,
      req.user.role,
    );
  }

  @Get('subloans-by-date/:date')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({
    summary: 'Obtener SubLoans que vencen en una fecha específica',
    description:
      'Retorna todos los SubLoans que tienen fecha de vencimiento en el día especificado.',
  })
  @ApiParam({
    name: 'date',
    description: 'Fecha a consultar (YYYY-MM-DD)',
    example: '2024-01-15',
  })
  @ApiResponse({
    status: 200,
    description: 'SubLoans obtenidos exitosamente',
  })
  async getSubLoansByDate(@Request() req: any, @Param('date') date: string) {
    return this.dailyClosureService.getSubLoansByDate(
      date,
      req.user.id,
      req.user.role,
    );
  }
}
