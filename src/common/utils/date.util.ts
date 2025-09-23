import { DateTime, Settings } from 'luxon';

// Configurar Luxon para usar la zona horaria de Buenos Aires por defecto
Settings.defaultZone = 'America/Argentina/Buenos_Aires';

export class DateUtil {
  // Zona horaria de Buenos Aires
  static readonly BUENOS_AIRES_TIMEZONE = 'America/Argentina/Buenos_Aires';

  /**
   * Obtiene la fecha/hora actual en Buenos Aires
   */
  static now(): DateTime {
    return DateTime.now().setZone(this.BUENOS_AIRES_TIMEZONE);
  }

  /**
   * Crea un DateTime desde un string ISO en zona horaria de Buenos Aires
   */
  static fromISO(isoString: string): DateTime {
    return DateTime.fromISO(isoString).setZone(this.BUENOS_AIRES_TIMEZONE);
  }

  /**
   * Crea un DateTime desde un objeto Date nativo en zona horaria de Buenos Aires
   */
  static fromJSDate(date: Date): DateTime {
    return DateTime.fromJSDate(date).setZone(this.BUENOS_AIRES_TIMEZONE);
  }

  /**
   * Crea un DateTime desde componentes de fecha en zona horaria de Buenos Aires
   */
  static fromObject(obj: {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
    millisecond?: number;
  }): DateTime {
    return DateTime.fromObject(obj, { zone: this.BUENOS_AIRES_TIMEZONE });
  }

  /**
   * Convierte un DateTime a Date nativo de JavaScript
   */
  static toJSDate(dateTime: DateTime): Date {
    return dateTime.toJSDate();
  }

  /**
   * Convierte un DateTime a string ISO
   */
  static toISO(dateTime: DateTime): string {
    return dateTime.toISO() || '';
  }

  /**
   * Formatea una fecha para mostrar en Buenos Aires
   */
  static format(dateTime: DateTime, format: string = 'dd/MM/yyyy HH:mm'): string {
    return dateTime.setZone(this.BUENOS_AIRES_TIMEZONE).toFormat(format);
  }

  /**
   * Convierte un string de fecha a Date para Prisma
   * Asegura que la fecha se interprete en zona horaria de Buenos Aires
   */
  static parseToDate(dateString: string): Date {
    const dt = DateTime.fromISO(dateString, { zone: this.BUENOS_AIRES_TIMEZONE });
    return dt.isValid ? dt.toJSDate() : new Date(dateString);
  }

  /**
   * Convierte una Date de Prisma a DateTime de Buenos Aires
   */
  static fromPrismaDate(date: Date): DateTime {
    return DateTime.fromJSDate(date).setZone(this.BUENOS_AIRES_TIMEZONE);
  }

  /**
   * Obtiene el inicio del día en Buenos Aires
   */
  static startOfDay(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).startOf('day');
  }

  /**
   * Obtiene el final del día en Buenos Aires
   */
  static endOfDay(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).endOf('day');
  }

  /**
   * Obtiene el inicio del mes en Buenos Aires
   */
  static startOfMonth(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).startOf('month');
  }

  /**
   * Obtiene el final del mes en Buenos Aires
   */
  static endOfMonth(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).endOf('month');
  }

  /**
   * Obtiene el inicio del año en Buenos Aires
   */
  static startOfYear(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).startOf('year');
  }

  /**
   * Obtiene el final del año en Buenos Aires
   */
  static endOfYear(dateTime?: DateTime): DateTime {
    const dt = dateTime || this.now();
    return dt.setZone(this.BUENOS_AIRES_TIMEZONE).endOf('year');
  }

  /**
   * Añade tiempo a una fecha
   */
  static plus(dateTime: DateTime, duration: { 
    years?: number; 
    months?: number; 
    weeks?: number; 
    days?: number; 
    hours?: number; 
    minutes?: number; 
    seconds?: number; 
  }): DateTime {
    return dateTime.plus(duration);
  }

  /**
   * Resta tiempo a una fecha
   */
  static minus(dateTime: DateTime, duration: { 
    years?: number; 
    months?: number; 
    weeks?: number; 
    days?: number; 
    hours?: number; 
    minutes?: number; 
    seconds?: number; 
  }): DateTime {
    return dateTime.minus(duration);
  }

  /**
   * Compara si una fecha es anterior a otra
   */
  static isBefore(dateTime1: DateTime, dateTime2: DateTime): boolean {
    return dateTime1 < dateTime2;
  }

  /**
   * Compara si una fecha es posterior a otra
   */
  static isAfter(dateTime1: DateTime, dateTime2: DateTime): boolean {
    return dateTime1 > dateTime2;
  }

  /**
   * Compara si una fecha está entre dos fechas
   */
  static isBetween(dateTime: DateTime, start: DateTime, end: DateTime): boolean {
    return dateTime >= start && dateTime <= end;
  }

  /**
   * Obtiene la diferencia entre dos fechas en días
   */
  static diffInDays(dateTime1: DateTime, dateTime2: DateTime): number {
    return Math.floor(dateTime1.diff(dateTime2, 'days').days);
  }

  /**
   * Obtiene la diferencia entre dos fechas en horas
   */
  static diffInHours(dateTime1: DateTime, dateTime2: DateTime): number {
    return Math.floor(dateTime1.diff(dateTime2, 'hours').hours);
  }

  /**
   * Valida si un string es una fecha válida
   */
  static isValidDate(dateString: string): boolean {
    return DateTime.fromISO(dateString).isValid;
  }

  /**
   * Convierte filtros de fecha string a Date para consultas Prisma
   */
  static parseFiltersToDate(filters: {
    createdFrom?: string;
    createdTo?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
  }): {
    createdFrom?: Date;
    createdTo?: Date;
    dueDateFrom?: Date;
    dueDateTo?: Date;
  } {
    const result: any = {};

    if (filters.createdFrom) {
      result.createdFrom = this.parseToDate(filters.createdFrom);
    }
    if (filters.createdTo) {
      result.createdTo = this.parseToDate(filters.createdTo);
    }
    if (filters.dueDateFrom) {
      result.dueDateFrom = this.parseToDate(filters.dueDateFrom);
    }
    if (filters.dueDateTo) {
      result.dueDateTo = this.parseToDate(filters.dueDateTo);
    }

    return result;
  }

  /**
   * Formatea una fecha para respuesta de API
   */
  static formatForAPI(date: Date | DateTime): string {
    if (date instanceof Date) {
      return this.fromJSDate(date).toISO() || '';
    }
    return date.setZone(this.BUENOS_AIRES_TIMEZONE).toISO() || '';
  }

  /**
   * Obtiene información de zona horaria
   */
  static getTimezoneInfo(): {
    timezone: string;
    offset: string;
    offsetMinutes: number;
  } {
    const dt = this.now();
    return {
      timezone: this.BUENOS_AIRES_TIMEZONE,
      offset: dt.toFormat('ZZ'),
      offsetMinutes: dt.offset,
    };
  }
}
