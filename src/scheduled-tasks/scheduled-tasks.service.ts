import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubLoansService } from '../sub-loans/sub-loans.service';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(private readonly subLoansService: SubLoansService) {}

  /**
   * Tarea programada que se ejecuta a las 4:00 AM todos los días
   * Activa los subloans que vencen ese día
   */
  @Cron('0 4 * * *', {
    name: 'activate-today-due-subloans',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async activateTodayDueSubLoans() {
    try {
      this.logger.log('Iniciando tarea programada: activar subloans que vencen hoy');
      
      const result = await this.subLoansService.activateTodayDueSubLoans();
      
      this.logger.log(`Tarea completada: ${result.message}`);
      
      return result;
    } catch (error) {
      this.logger.error('Error en tarea programada de activación de subloans:', error);
      throw error;
    }
  }

  /**
   * Método para ejecutar manualmente la tarea (para testing)
   */
  async runActivateTodayDueSubLoansManually() {
    this.logger.log('Ejecutando manualmente la tarea de activación de subloans');
    return this.activateTodayDueSubLoans();
  }
}