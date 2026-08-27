import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { ClientLossesService } from './client-losses.service';
import { CreateClientLossDto } from './dto/create-client-loss.dto';

@ApiTags('Client Losses')
@Controller('client-losses')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClientLossesController {
  constructor(private readonly clientLossesService: ClientLossesService) {}

  @Post('client/:clientId')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Dar de baja un cliente por pérdida (deuda incobrable)',
  })
  @ApiResponse({ status: 201, description: 'Cliente dado de baja por pérdida' })
  @ApiResponse({ status: 403, description: 'Sin permisos sobre el cliente' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  async markAsLoss(
    @Param('clientId') clientId: string,
    @Body() dto: CreateClientLossDto,
    @Request() req,
  ) {
    return this.clientLossesService.markAsLoss(
      clientId,
      req.user.id,
      dto.notes,
    );
  }

  @Get()
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({ summary: 'Listar pérdidas registradas (según rol)' })
  @ApiResponse({ status: 200, description: 'Listado de pérdidas' })
  async findAll(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clientLossesService.findAll(
      req.user.id,
      req.user.role,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post(':id/revert')
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Revertir una pérdida (hasta 96hs después de registrada)',
  })
  @ApiResponse({ status: 201, description: 'Pérdida revertida' })
  @ApiResponse({ status: 400, description: 'Ventana expirada o ya revertida' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async revert(@Param('id') id: string, @Request() req) {
    return this.clientLossesService.revert(id, req.user.id, req.user.role);
  }
}
