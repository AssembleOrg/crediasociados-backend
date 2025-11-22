import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubLoansService } from '../sub-loans/sub-loans.service';
import { CollectionRoutesService } from '../collection-routes/collection-routes.service';
import { DailyReportsService } from '../daily-reports/daily-reports.service';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly subLoansService: SubLoansService,
    private readonly collectionRoutesService: CollectionRoutesService,
    private readonly dailyReportsService: DailyReportsService,
  ) {}

  /**
   * Tarea programada que se ejecuta a las 4:00 AM todos los días
   * Activa los subloans que vencen ese día
   */
  // @Cron('0 4 * * *', {
  //   name: 'activate-today-due-subloans',
  //   timeZone: 'America/Argentina/Buenos_Aires',
  // })
  async activateTodayDueSubLoans() {
    try {
      this.logger.log(
        'Iniciando tarea programada: activar subloans que vencen hoy',
      );

      const result = await this.subLoansService.activateTodayDueSubLoans();

      this.logger.log(`Tarea completada: ${result.message}`);

      return result;
    } catch (error) {
      this.logger.error(
        'Error en tarea programada de activación de subloans:',
        error,
      );
      throw error;
    }
  }

  /**
   * Método para ejecutar manualmente la tarea (para testing)
   */
  async runActivateTodayDueSubLoansManually() {
    this.logger.log(
      'Ejecutando manualmente la tarea de activación de subloans',
    );
    return this.activateTodayDueSubLoans();
  }

  /**
   * Tarea programada que se ejecuta a las 4:15 AM todos los días
   * Crea las rutas de cobro diarias para todos los managers
   */
  @Cron('15 4 * * *', {
    name: 'create-daily-collection-routes',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async createDailyCollectionRoutes() {
    try {
      this.logger.log(
        'Iniciando tarea programada: crear rutas de cobro diarias',
      );

      const result =
        await this.collectionRoutesService.createDailyRoutes();

      this.logger.log(
        `Tarea completada: ${result.message} - ${result.createdRoutes.length} rutas creadas`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        'Error en tarea programada de creación de rutas de cobro:',
        error,
      );
      throw error;
    }
  }

  /**
   * Método para ejecutar manualmente la creación de rutas (para testing)
   */
  async runCreateDailyCollectionRoutesManually() {
    this.logger.log(
      'Ejecutando manualmente la tarea de creación de rutas de cobro',
    );
    return this.createDailyCollectionRoutes();
  }

  /**
   * Tarea programada que se ejecuta a las 23:59 todos los días
   * Marca como OVERDUE todos los subloans cuya fecha de vencimiento ya pasó
   */
  @Cron('59 23 * * *', {
    name: 'mark-overdue-subloans',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async markOverdueSubLoans() {
    try {
      this.logger.log(
        'Iniciando tarea programada: marcar subloans vencidos como OVERDUE',
      );

      const result = await this.subLoansService.markOverdueSubLoans();

      this.logger.log(`Tarea completada: ${result.message}`);

      return result;
    } catch (error) {
      this.logger.error(
        'Error en tarea programada de marcado de subloans vencidos:',
        error,
      );
      throw error;
    }
  }

  /**
   * Método para ejecutar manualmente el marcado de subloans vencidos (para testing)
   */
  async runMarkOverdueSubLoansManually() {
    this.logger.log(
      'Ejecutando manualmente la tarea de marcado de subloans vencidos',
    );
    return this.markOverdueSubLoans();
  }

  /**
   * Tarea programada que se ejecuta a las 03:00 AM todos los días (horario argentino)
   * Genera el reporte diario en PDF y lo envía por email y guarda en bucket
   */
  @Cron('0 3 * * *', {
    name: 'generate-daily-report',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async generateDailyReport() {
    try {
      this.logger.log(
        'Iniciando tarea programada: generar reporte diario',
      );

      const result = await this.dailyReportsService.generateDailyReport();

      if (result.success) {
        this.logger.log(
          `Tarea completada: Reporte diario generado exitosamente - ${result.filename}`,
        );
      } else {
        this.logger.error(
          `Error al generar reporte diario: ${result.error}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        'Error en tarea programada de generación de reporte diario:',
        error,
      );
      // No lanzamos el error para que no rompa la app
      return { success: false, error: error.message };
    }
  }

  /**
   * Método para ejecutar manualmente la generación de reporte diario (para testing)
   */
  async runGenerateDailyReportManually(reportDate?: Date) {
    this.logger.log(
      'Ejecutando manualmente la tarea de generación de reporte diario',
    );
    return this.dailyReportsService.generateDailyReport(reportDate);
  }

  /**
   * Tarea programada que se ejecuta los domingos a las 23:50 (horario argentino)
   * Genera el reporte semanal en PDF (desde el lunes hasta el domingo de esa semana)
   * y lo envía por email y guarda en bucket
   */
  @Cron('50 23 * * 0', {
    name: 'generate-weekly-report',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async generateWeeklyReport() {
    try {
      this.logger.log(
        'Iniciando tarea programada: generar reporte semanal',
      );

      const result = await this.dailyReportsService.generateWeeklyReport();

      if (result.success) {
        this.logger.log(
          `Tarea completada: Reporte semanal generado exitosamente - ${result.filename}`,
        );
      } else {
        this.logger.error(
          `Error al generar reporte semanal: ${result.error}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        'Error en tarea programada de generación de reporte semanal:',
        error,
      );
      // No lanzamos el error para que no rompa la app
      return { success: false, error: error.message };
    }
  }

  /**
   * Método para ejecutar manualmente la generación de reporte semanal (para testing)
   */
  async runGenerateWeeklyReportManually(reportDate?: Date) {
    this.logger.log(
      'Ejecutando manualmente la tarea de generación de reporte semanal',
    );
    return this.dailyReportsService.generateWeeklyReport(reportDate);
  }
}
