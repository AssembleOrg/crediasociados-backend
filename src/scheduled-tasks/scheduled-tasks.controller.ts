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

  @Post('close-yesterday-routes')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Cerrar rutas de cobro activas previas a hoy',
    description:
      'Cierra automáticamente todas las rutas de cobro activas previas a la fecha actual. Ejecuta manualmente la tarea que normalmente se ejecuta a las 3:30 AM (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Rutas de cobro cerradas exitosamente',
    schema: {
      type: 'object',
      properties: {
        closedRoutes: { type: 'number', description: 'Cantidad de rutas cerradas' },
        message: { type: 'string', description: 'Mensaje descriptivo del resultado' },
        routes: { type: 'array', items: { type: 'string' }, description: 'IDs de las rutas cerradas' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runCloseYesterdayRoutesManually() {
    const result =
      await this.scheduledTasksService.runCloseYesterdayRoutesManually();
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

  @Post('generate-daily-report')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Ejecutar manualmente la generación de reporte diario',
    description:
      'Genera el reporte diario en PDF y lo envía por email y guarda en bucket (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte diario generado exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runGenerateDailyReportManually() {
    const result =
      await this.scheduledTasksService.runGenerateDailyReportManually();
    return result;
  }

  @Post('generate-weekly-report')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Ejecutar manualmente la generación de reporte semanal',
    description:
      'Genera el reporte semanal en PDF (desde el lunes hasta el domingo de esa semana) y lo envía por email y guarda en bucket (solo para admins)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte semanal generado exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Prohibido - Solo administradores' })
  async runGenerateWeeklyReportManually() {
    const result =
      await this.scheduledTasksService.runGenerateWeeklyReportManually();
    return result;
  }
}
