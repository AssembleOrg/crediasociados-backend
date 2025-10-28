import { Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { ScheduledTasksService } from './scheduled-tasks.service';

@ApiTags('Scheduled Tasks')
@Controller('scheduled-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Post('activate-today-due-subloans')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Ejecutar manualmente la activación de subloans que vencen hoy',
    description:
      'Ejecuta manualmente la tarea que normalmente se ejecuta a las 4:00 AM (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Tarea ejecutada exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runActivateTodayDueSubLoansManually() {
    const result =
      await this.scheduledTasksService.runActivateTodayDueSubLoansManually();
    return result;
  }

  @Post('create-daily-collection-routes')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Ejecutar manualmente la creación de rutas de cobro diarias',
    description:
      'Ejecuta manualmente la tarea que normalmente se ejecuta a las 4:15 AM (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Rutas de cobro creadas exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runCreateDailyCollectionRoutesManually() {
    const result =
      await this.scheduledTasksService.runCreateDailyCollectionRoutesManually();
    return result;
  }

  @Post('mark-overdue-subloans')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Ejecutar manualmente el marcado de subloans vencidos',
    description:
      'Marca como OVERDUE todos los subloans cuya fecha de vencimiento ya pasó (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Subloans vencidos marcados exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runMarkOverdueSubLoansManually() {
    const result =
      await this.scheduledTasksService.runMarkOverdueSubLoansManually();
    return result;
  }
}
