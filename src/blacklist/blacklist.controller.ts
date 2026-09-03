import {
  Controller,
  Get,
  Post,
  Delete,
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
} from '@nestjs/swagger';
import { BlacklistService } from './blacklist.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('Blacklist')
@Controller('blacklist')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BlacklistController {
  constructor(private readonly blacklistService: BlacklistService) {}

  @Get()
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Obtener todos los clientes en lista negra' })
  @ApiResponse({ status: 200, description: 'Lista negra obtenida exitosamente' })
  async getAll() {
    return this.blacklistService.getAll();
  }

  @Post()
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Agregar cliente a la lista negra' })
  @ApiResponse({ status: 201, description: 'Cliente agregado a lista negra' })
  @ApiResponse({ status: 400, description: 'DNI ya existe en la lista negra' })
  async add(
    @Body()
    body: {
      dni?: string;
      cuit?: string;
      fullName: string;
      reason: string;
      clientId?: string;
    },
    @Request() req,
  ) {
    return this.blacklistService.addToBlacklist({
      dni: body.dni,
      cuit: body.cuit,
      fullName: body.fullName,
      reason: body.reason,
      userId: req.user.id,
      clientId: body.clientId,
    });
  }

  @Delete(':id')
  @Roles(UserRole.SUBADMIN, UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Eliminar cliente de la lista negra' })
  @ApiResponse({ status: 200, description: 'Cliente eliminado de lista negra' })
  @ApiResponse({ status: 404, description: 'Entrada no encontrada' })
  async remove(@Param('id') id: string) {
    return this.blacklistService.removeFromBlacklist(id);
  }

  @Get('check')
  @Roles(
    UserRole.MANAGER,
    UserRole.SUBADMIN,
    UserRole.ADMIN,
    UserRole.SUPERADMIN,
  )
  @ApiOperation({ summary: 'Verificar si un DNI y/o CUIT está en la lista negra' })
  @ApiResponse({ status: 200, description: 'Resultado del chequeo' })
  async check(@Query('dni') dni?: string, @Query('cuit') cuit?: string) {
    const entry = await this.blacklistService.check(dni, cuit);
    return {
      isBlacklisted: !!entry,
      entry: entry || null,
    };
  }
}
