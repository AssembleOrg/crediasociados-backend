import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ConfigService } from '@nestjs/config';
import * as PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { DateUtil } from '../common/utils/date.util';
import { SubLoanStatus } from '@prisma/client';

@Injectable()
export class DailyReportsService {
  private readonly logger = new Logger(DailyReportsService.name);
  private readonly emailRecipients: string[];

  constructor(
    private prisma: PrismaService,
    private rabbitMQService: RabbitMQService,
    private configService: ConfigService,
  ) {
    const recipients = this.configService.get<string>('DAILY_REPORT_EMAIL_RECIPIENTS') || '';
    this.emailRecipients = recipients.split(',').filter(Boolean);
  }

  /**
   * Genera el reporte semanal para una semana específica
   * @param reportDate Fecha del domingo de la semana (opcional, por defecto usa el domingo actual)
   */
  async generateWeeklyReport(reportDate?: Date): Promise<{ success: boolean; pdfBase64?: string; filename?: string; error?: string }> {
    try {
      // Usar la fecha proporcionada o el domingo actual en horario argentino
      const date = reportDate 
        ? DateTime.fromJSDate(reportDate).setZone('America/Argentina/Buenos_Aires')
        : DateTime.now().setZone('America/Argentina/Buenos_Aires');

      // Obtener el domingo de la semana (último día de la semana)
      const sunday = date.endOf('week');
      // Obtener el lunes de la semana (primer día de la semana)
      const monday = sunday.startOf('week');

      const weekStartStr = monday.toFormat('yyyy-MM-dd');
      const weekEndStr = sunday.toFormat('yyyy-MM-dd');
      const weekLabel = `${monday.toFormat('dd/MM/yyyy')} - ${sunday.toFormat('dd/MM/yyyy')}`;

      this.logger.log(`Generando reporte semanal para la semana ${weekLabel} (${weekStartStr} a ${weekEndStr})`);

      // Obtener todos los datos necesarios del rango semanal
      const [
        safeTransactions,
        collectorWalletTransactions,
        clients,
        loansData,
        paymentsWeek,
        totalSafeBalance,
        totalCollectorWalletBalance,
        totalActiveLoans,
        totalLoansAmount,
      ] = await Promise.all([
        this.getSafeTransactionsRange(weekStartStr, weekEndStr),
        this.getCollectorWalletTransactionsRange(weekStartStr, weekEndStr),
        this.getClients(),
        this.getLoansWithSubLoansRange(weekStartStr, weekEndStr),
        this.getPaymentsFromDateRange(weekStartStr, weekEndStr),
        this.getTotalSafeBalance(),
        this.getTotalCollectorWalletBalance(),
        this.getTotalActiveLoans(),
        this.getTotalLoansAmount(),
      ]);

      // Generar PDF semanal
      const { pdfBase64, filename } = await this.generateWeeklyPDF({
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        weekLabel,
        safeTransactions,
        collectorWalletTransactions,
        clients,
        loans: loansData,
        paymentsWeek,
        totalSafeBalance,
        totalCollectorWalletBalance,
        totalActiveLoans,
        totalLoansAmount,
      });

      // Enviar por email (try-catch interno)
      // IMPORTANTE: Cada operación es independiente y no debe afectar a la otra
      try {
        const emailSent = await this.rabbitMQService.sendEmailWithPDF(
          this.emailRecipients,
          `Reporte Semanal - ${weekLabel}`,
          pdfBase64,
          filename,
        );

        if (emailSent) {
          this.logger.log(`Email enviado exitosamente para reporte semanal ${weekLabel}`);
        } else {
          this.logger.warn(`No se pudo enviar el email para reporte semanal ${weekLabel}`);
        }
      } catch (error) {
        this.logger.error(`Error al enviar email para reporte semanal ${weekLabel}:`, error);
        // No lanzamos el error, continuamos
        // La conexión RabbitMQ se reiniciará automáticamente en el próximo mensaje
      }

      // Pequeño delay para asegurar que cualquier limpieza de conexión se complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Guardar en bucket (try-catch interno)
      // Esta operación es completamente independiente de la anterior
      try {
        const saved = await this.rabbitMQService.saveHistoryPDF(pdfBase64, filename);

        if (saved) {
          this.logger.log(`PDF guardado en bucket exitosamente para reporte semanal ${weekLabel}`);
        } else {
          this.logger.warn(`No se pudo guardar el PDF en bucket para reporte semanal ${weekLabel}`);
        }
      } catch (error) {
        this.logger.error(`Error al guardar PDF en bucket para reporte semanal ${weekLabel}:`, error);
        // No lanzamos el error, continuamos
      }

      return {
        success: true,
        pdfBase64,
        filename,
      };
    } catch (error: any) {
      this.logger.error('Error al generar reporte semanal:', error);
      
      // Proporcionar mensajes de error más descriptivos
      let errorMessage = error.message || 'Error desconocido';
      
      // Si es un error de conexión a la base de datos
      if (error.code === 'P1001' || error.message?.includes("Can't reach database server")) {
        errorMessage = `Error de conexión a la base de datos: ${error.meta?.database_location || 'servidor no accesible'}. Verifique que el servidor esté en ejecución y accesible.`;
      }
      
      // Si es un error de Prisma
      if (error.code?.startsWith('P')) {
        errorMessage = `Error de base de datos (${error.code}): ${error.message}`;
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Genera el reporte diario para una fecha específica
   * @param reportDate Fecha del reporte (opcional, por defecto usa la fecha actual)
   */
  async generateDailyReport(reportDate?: Date): Promise<{ success: boolean; pdfBase64?: string; filename?: string; error?: string }> {
    try {
      // Usar la fecha proporcionada o la fecha actual en horario argentino
      const date = reportDate 
        ? DateTime.fromJSDate(reportDate).setZone('America/Argentina/Buenos_Aires')
        : DateTime.now().setZone('America/Argentina/Buenos_Aires');

      const dateStr = date.toFormat('yyyy-MM-dd');
      // El reporte del día X muestra datos del día anterior (X-1)
      const previousDate = date.minus({ days: 1 });
      const previousDateStr = previousDate.toFormat('yyyy-MM-dd');

      this.logger.log(`Generando reporte diario para ${dateStr} (datos del día anterior: ${previousDateStr})`);

      // Obtener todos los datos necesarios del DÍA ANTERIOR
      const [
        safeTransactions,
        collectorWalletTransactions,
        clients,
        loansData,
        paymentsYesterday,
        totalSafeBalance,
        totalCollectorWalletBalance,
        totalActiveLoans,
        totalLoansAmount,
      ] = await Promise.all([
        this.getSafeTransactions(previousDateStr), // ← Datos del día anterior
        this.getCollectorWalletTransactions(previousDateStr), // ← Datos del día anterior
        this.getClients(),
        this.getLoansWithSubLoans(previousDateStr),
        this.getPaymentsFromDate(previousDateStr),
        this.getTotalSafeBalance(),
        this.getTotalCollectorWalletBalance(),
        this.getTotalActiveLoans(),
        this.getTotalLoansAmount(),
      ]);

      // Generar PDF
      const { pdfBase64, filename } = await this.generatePDF({
        reportDate: dateStr,
        previousDateStr,
        safeTransactions,
        collectorWalletTransactions,
        clients,
        loans: loansData,
        paymentsYesterday,
        totalSafeBalance,
        totalCollectorWalletBalance,
        totalActiveLoans,
        totalLoansAmount,
      });

      // Enviar por email (try-catch interno)
      // IMPORTANTE: Cada operación es independiente y no debe afectar a la otra
      try {
        const emailSent = await this.rabbitMQService.sendEmailWithPDF(
          this.emailRecipients,
          `Reporte Diario - ${dateStr}`,
          pdfBase64,
          filename,
        );

        if (emailSent) {
          this.logger.log(`Email enviado exitosamente para reporte ${dateStr}`);
        } else {
          this.logger.warn(`No se pudo enviar el email para reporte ${dateStr}`);
        }
      } catch (error) {
        this.logger.error(`Error al enviar email para reporte ${dateStr}:`, error);
        // No lanzamos el error, continuamos
        // La conexión RabbitMQ se reiniciará automáticamente en el próximo mensaje
      }

      // Pequeño delay para asegurar que cualquier limpieza de conexión se complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Guardar en bucket (try-catch interno)
      // Esta operación es completamente independiente de la anterior
      try {
        const saved = await this.rabbitMQService.saveHistoryPDF(pdfBase64, filename);

        if (saved) {
          this.logger.log(`PDF guardado en bucket exitosamente para reporte ${dateStr}`);
        } else {
          this.logger.warn(`No se pudo guardar el PDF en bucket para reporte ${dateStr}`);
        }
      } catch (error) {
        this.logger.error(`Error al guardar PDF en bucket para reporte ${dateStr}:`, error);
        // No lanzamos el error, continuamos
      }

      return {
        success: true,
        pdfBase64,
        filename,
      };
    } catch (error: any) {
      this.logger.error('Error al generar reporte diario:', error);
      
      // Proporcionar mensajes de error más descriptivos
      let errorMessage = error.message || 'Error desconocido';
      
      // Si es un error de conexión a la base de datos
      if (error.code === 'P1001' || error.message?.includes("Can't reach database server")) {
        errorMessage = `Error de conexión a la base de datos: ${error.meta?.database_location || 'servidor no accesible'}. Verifique que el servidor esté en ejecución y accesible.`;
      }
      
      // Si es un error de Prisma
      if (error.code?.startsWith('P')) {
        errorMessage = `Error de base de datos (${error.code}): ${error.message}`;
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Obtiene transacciones de Safe en un rango de fechas
   */
  private async getSafeTransactionsRange(startDateStr: string, endDateStr: string) {
    const startDate = DateTime.fromISO(startDateStr).setZone('America/Argentina/Buenos_Aires').startOf('day');
    const endDate = DateTime.fromISO(endDateStr).setZone('America/Argentina/Buenos_Aires').endOf('day');

    const transactions = await this.prisma.safeTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate.toJSDate(),
          lte: endDate.toJSDate(),
        },
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
        expense: {
          select: {
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return transactions.map(t => ({
      tipo: t.type,
      monto: Number(t.amount),
      descripcion: t.description,
      saldoAnterior: Number(t.balanceBefore),
      saldoPosterior: Number(t.balanceAfter),
      usuario: t.user.fullName,
      categoriaGasto: t.expense?.name || null,
      fecha: DateTime.fromJSDate(t.createdAt).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
    }));
  }

  /**
   * Obtiene transacciones de Safe del día
   */
  private async getSafeTransactions(dateStr: string) {
    const startDate = DateTime.fromISO(dateStr).setZone('America/Argentina/Buenos_Aires').startOf('day');
    const endDate = startDate.endOf('day');

    const transactions = await this.prisma.safeTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate.toJSDate(),
          lte: endDate.toJSDate(),
        },
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
        expense: {
          select: {
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return transactions.map(t => ({
      tipo: t.type,
      monto: Number(t.amount),
      descripcion: t.description,
      saldoAnterior: Number(t.balanceBefore),
      saldoPosterior: Number(t.balanceAfter),
      usuario: t.user.fullName,
      categoriaGasto: t.expense?.name || null,
      fecha: DateTime.fromJSDate(t.createdAt).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
    }));
  }

  /**
   * Obtiene transacciones de Collector Wallet en un rango de fechas
   */
  private async getCollectorWalletTransactionsRange(startDateStr: string, endDateStr: string) {
    const startDate = DateTime.fromISO(startDateStr).setZone('America/Argentina/Buenos_Aires').startOf('day');
    const endDate = DateTime.fromISO(endDateStr).setZone('America/Argentina/Buenos_Aires').endOf('day');

    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate.toJSDate(),
          lte: endDate.toJSDate(),
        },
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return transactions.map(t => ({
      tipo: t.type,
      monto: Number(t.amount),
      descripcion: t.description,
      saldoAnterior: Number(t.balanceBefore || 0),
      saldoPosterior: Number(t.balanceAfter || 0),
      usuario: t.user.fullName,
      fecha: DateTime.fromJSDate(t.createdAt).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
    }));
  }

  /**
   * Obtiene transacciones de Collector Wallet del día
   */
  private async getCollectorWalletTransactions(dateStr: string) {
    const startDate = DateTime.fromISO(dateStr).setZone('America/Argentina/Buenos_Aires').startOf('day');
    const endDate = startDate.endOf('day');

    const transactions = await this.prisma.collectorWalletTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate.toJSDate(),
          lte: endDate.toJSDate(),
        },
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return transactions.map(t => ({
      tipo: t.type,
      monto: Number(t.amount),
      descripcion: t.description,
      saldoAnterior: Number(t.balanceBefore || 0),
      saldoPosterior: Number(t.balanceAfter || 0),
      usuario: t.user.fullName,
      fecha: DateTime.fromJSDate(t.createdAt).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
    }));
  }

  /**
   * Obtiene todos los clientes activos
   */
  private async getClients() {
    const clients = await this.prisma.client.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        managers: {
          where: {
            deletedAt: null,
          },
          include: {
            user: {
              select: {
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return clients.map(c => ({
      nombre: c.fullName,
      dni: c.dni || 'N/A',
      cuit: c.cuit || 'N/A',
      telefono: c.phone || 'N/A',
      email: c.email || 'N/A',
      direccion: c.address || 'N/A',
      managers: c.managers.map(m => m.user.fullName).join(', '),
    }));
  }

  /**
   * Obtiene préstamos con subpréstamos en un rango de fechas
   * Solo incluye préstamos que tienen subpréstamos pendientes O pagos en el rango
   */
  private async getLoansWithSubLoansRange(startDateStr: string, endDateStr: string) {
    const startDate = DateTime.fromISO(startDateStr).setZone('America/Argentina/Buenos_Aires');
    const endDate = DateTime.fromISO(endDateStr).setZone('America/Argentina/Buenos_Aires');
    const startOfRange = startDate.startOf('day').toJSDate();
    const endOfRange = endDate.endOf('day').toJSDate();

    // Obtener todos los préstamos activos con sus subpréstamos
    const allLoans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        status: {
          in: ['APPROVED', 'ACTIVE'],
        },
      },
      include: {
        client: {
          select: {
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            email: true,
          },
        },
        subLoans: {
          where: {
            deletedAt: null,
          },
          include: {
            payments: {
              where: {
                paymentDate: {
                  gte: startOfRange,
                  lte: endOfRange,
                },
              },
            },
          },
        },
      },
    });

    // Filtrar préstamos que tienen subpréstamos pendientes O pagos en el rango
    const filteredLoans = allLoans.filter(loan => {
      const hasPendingSubLoans = loan.subLoans.some(
        sub => sub.status === SubLoanStatus.PENDING || sub.status === SubLoanStatus.OVERDUE || sub.status === SubLoanStatus.PARTIAL
      );
      const hasPaymentsInRange = loan.subLoans.some(sub => sub.payments.length > 0);
      
      return hasPendingSubLoans || hasPaymentsInRange;
    });

    return filteredLoans.map(loan => {
      const totalSubLoans = loan.subLoans.length;
      const paidSubLoans = loan.subLoans.filter(sub => sub.status === SubLoanStatus.PAID).length;
      const pendingSubLoans = loan.subLoans.filter(
        sub => sub.status === SubLoanStatus.PENDING || sub.status === SubLoanStatus.OVERDUE || sub.status === SubLoanStatus.PARTIAL
      ).length;

      return {
        numeroPrestamo: loan.loanTrack,
        cliente: loan.client.fullName,
        dni: loan.client.dni || 'N/A',
        montoOriginal: Number(loan.originalAmount),
        montoTotal: Number(loan.amount),
        tasaInteres: Number(loan.baseInterestRate),
        totalCuotas: loan.totalPayments,
        cuotasPagadas: paidSubLoans,
        cuotasPendientes: pendingSubLoans,
        totalSubPrestamos: totalSubLoans,
        resumen: `${paidSubLoans} de ${totalSubLoans}`,
        pagosSemana: loan.subLoans.reduce((acc, sub) => acc + sub.payments.length, 0),
      };
    });
  }

  /**
   * Obtiene préstamos con subpréstamos
   * Solo incluye préstamos que tienen subpréstamos pendientes O pagos del día anterior
   */
  private async getLoansWithSubLoans(previousDateStr: string) {
    const previousDate = DateTime.fromISO(previousDateStr).setZone('America/Argentina/Buenos_Aires');
    const startOfPreviousDay = previousDate.startOf('day').toJSDate();
    const endOfPreviousDay = previousDate.endOf('day').toJSDate();

    // Obtener todos los préstamos activos con sus subpréstamos
    const allLoans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        status: {
          in: ['APPROVED', 'ACTIVE'],
        },
      },
      include: {
        client: {
          select: {
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            email: true,
          },
        },
        subLoans: {
          where: {
            deletedAt: null,
          },
          include: {
            payments: {
              where: {
                paymentDate: {
                  gte: startOfPreviousDay,
                  lte: endOfPreviousDay,
                },
              },
            },
          },
        },
      },
    });

    // Filtrar préstamos que tienen subpréstamos pendientes O pagos del día anterior
    const filteredLoans = allLoans.filter(loan => {
      const hasPendingSubLoans = loan.subLoans.some(
        sub => sub.status === SubLoanStatus.PENDING || sub.status === SubLoanStatus.OVERDUE || sub.status === SubLoanStatus.PARTIAL
      );
      const hasPaymentsYesterday = loan.subLoans.some(sub => sub.payments.length > 0);
      
      return hasPendingSubLoans || hasPaymentsYesterday;
    });

    return filteredLoans.map(loan => {
      const totalSubLoans = loan.subLoans.length;
      const paidSubLoans = loan.subLoans.filter(sub => sub.status === SubLoanStatus.PAID).length;
      const pendingSubLoans = loan.subLoans.filter(
        sub => sub.status === SubLoanStatus.PENDING || sub.status === SubLoanStatus.OVERDUE || sub.status === SubLoanStatus.PARTIAL
      ).length;

      return {
        numeroPrestamo: loan.loanTrack,
        cliente: loan.client.fullName,
        dni: loan.client.dni || 'N/A',
        montoOriginal: Number(loan.originalAmount),
        montoTotal: Number(loan.amount),
        tasaInteres: Number(loan.baseInterestRate),
        totalCuotas: loan.totalPayments,
        cuotasPagadas: paidSubLoans,
        cuotasPendientes: pendingSubLoans,
        totalSubPrestamos: totalSubLoans,
        resumen: `${paidSubLoans} de ${totalSubLoans}`,
        pagosAyer: loan.subLoans.reduce((acc, sub) => acc + sub.payments.length, 0),
      };
    });
  }

  /**
   * Obtiene el balance total de todas las cajas fuertes
   */
  private async getTotalSafeBalance(): Promise<number> {
    const result = await this.prisma.safe.aggregate({
      _sum: {
        balance: true,
      },
    });
    return Number(result._sum.balance || 0);
  }

  /**
   * Obtiene el balance total de todas las wallets de cobros
   */
  private async getTotalCollectorWalletBalance(): Promise<number> {
    const result = await this.prisma.collectorWallet.aggregate({
      _sum: {
        balance: true,
      },
    });
    return Number(result._sum.balance || 0);
  }

  /**
   * Obtiene el total de préstamos activos
   */
  private async getTotalActiveLoans(): Promise<number> {
    return this.prisma.loan.count({
      where: {
        deletedAt: null,
        status: {
          in: ['APPROVED', 'ACTIVE'],
        },
      },
    });
  }

  /**
   * Obtiene el monto total de préstamos activos
   */
  private async getTotalLoansAmount(): Promise<number> {
    const result = await this.prisma.loan.aggregate({
      where: {
        deletedAt: null,
        status: {
          in: ['APPROVED', 'ACTIVE'],
        },
      },
      _sum: {
        amount: true,
      },
    });
    return Number(result._sum.amount || 0);
  }

  /**
   * Obtiene pagos realizados en un rango de fechas
   */
  private async getPaymentsFromDateRange(startDateStr: string, endDateStr: string) {
    const startDate = DateTime.fromISO(startDateStr).setZone('America/Argentina/Buenos_Aires');
    const endDate = DateTime.fromISO(endDateStr).setZone('America/Argentina/Buenos_Aires');
    const startOfRange = startDate.startOf('day').toJSDate();
    const endOfRange = endDate.endOf('day').toJSDate();

    const payments = await this.prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: startOfRange,
          lte: endOfRange,
        },
      },
      include: {
        subLoan: {
          include: {
            loan: {
              include: {
                client: {
                  select: {
                    fullName: true,
                    dni: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        paymentDate: 'asc',
      },
    });

    return payments.map(p => ({
      monto: Number(p.amount),
      fecha: DateTime.fromJSDate(p.paymentDate).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
      cliente: p.subLoan.loan.client.fullName,
      dni: p.subLoan.loan.client.dni || 'N/A',
      numeroPrestamo: p.subLoan.loan.loanTrack,
      numeroCuota: p.subLoan.paymentNumber,
      descripcion: p.description || 'Pago de cuota',
    }));
  }

  /**
   * Obtiene pagos realizados en una fecha específica
   */
  private async getPaymentsFromDate(dateStr: string) {
    const date = DateTime.fromISO(dateStr).setZone('America/Argentina/Buenos_Aires');
    const startOfDay = date.startOf('day').toJSDate();
    const endOfDay = date.endOf('day').toJSDate();

    const payments = await this.prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        subLoan: {
          include: {
            loan: {
              include: {
                client: {
                  select: {
                    fullName: true,
                    dni: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        paymentDate: 'asc',
      },
    });

    return payments.map(p => ({
      monto: Number(p.amount),
      fecha: DateTime.fromJSDate(p.paymentDate).setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm'),
      cliente: p.subLoan.loan.client.fullName,
      dni: p.subLoan.loan.client.dni || 'N/A',
      numeroPrestamo: p.subLoan.loan.loanTrack,
      numeroCuota: p.subLoan.paymentNumber,
      descripcion: p.description || 'Pago de cuota',
    }));
  }

  /**
   * Genera el PDF del reporte con diseño profesional
   */
  private async generatePDF(data: {
    reportDate: string;
    previousDateStr: string;
    safeTransactions: any[];
    collectorWalletTransactions: any[];
    clients: any[];
    loans: any[];
    paymentsYesterday: any[];
    totalSafeBalance: number;
    totalCollectorWalletBalance: number;
    totalActiveLoans: number;
    totalLoansAmount: number;
  }): Promise<{ pdfBase64: string; filename: string }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 60, bottom: 60, left: 40, right: 40 },
        });

        const chunks: Buffer[] = [];
        const previousDate = DateTime.fromISO(data.previousDateStr);

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          const pdfBase64 = pdfBuffer.toString('base64');
          // Formato: reporte-diario-YYYY-MM-DD.pdf
          const filename = `reporte-diario-${data.reportDate}.pdf`;
          resolve({ pdfBase64, filename });
        });
        doc.on('error', reject);

        // Función helper para agregar pie de página
        const addFooter = (pageNumber?: number) => {
          const currentPage = pageNumber || (doc.bufferedPageRange()?.count || 1);
          const footerY = doc.page.height - 40;
          doc.fontSize(8)
            .fillColor('#666666')
            .text(
              `Página ${currentPage} | Generado el ${DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm')} hs`,
              40,
              footerY,
              { align: 'center', width: doc.page.width - 80 }
            );
        };

        // Función helper para agregar encabezado de sección
        const addSectionHeader = (title: string) => {
          if (doc.y > doc.page.height - 100) {
            doc.addPage();
          }
          doc.moveDown(1);
          doc.fontSize(14)
            .fillColor('#1a1a1a')
            .font('Helvetica-Bold')
            .text(title, { underline: false });
          doc.moveDown(0.3);
          // Línea decorativa
          doc.moveTo(40, doc.y)
            .lineTo(doc.page.width - 40, doc.y)
            .strokeColor('#cccccc')
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.5);
        };

        // Encabezado principal con diseño profesional
        doc.rect(0, 0, doc.page.width, 80)
          .fillColor('#2c3e50')
          .fill();
        
        doc.fontSize(24)
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .text('REPORTE DIARIO', 40, 30, { align: 'left' });
        
        doc.fontSize(12)
          .fillColor('#ecf0f1')
          .font('Helvetica')
          .text(`Fecha del Reporte: ${this.formatDate(data.reportDate)}`, 40, 55, { align: 'left' });
        
        doc.fontSize(10)
          .fillColor('#bdc3c7')
          .text(`Período de datos: ${previousDate.toFormat('dd/MM/yyyy')}`, 40, 70, { align: 'left' });

        doc.y = 100;

        // Resumen Ejecutivo con diseño mejorado
        addSectionHeader('RESUMEN EJECUTIVO');
        doc.fontSize(10).fillColor('#2c3e50').font('Helvetica');
        
        // Calcular totales del día
        const totalSafeIngresos = data.safeTransactions
          .filter(t => t.monto > 0)
          .reduce((sum, t) => sum + t.monto, 0);
        const totalSafeEgresos = Math.abs(data.safeTransactions
          .filter(t => t.monto < 0)
          .reduce((sum, t) => sum + t.monto, 0));
        
        const totalWalletIngresos = data.collectorWalletTransactions
          .filter(t => t.monto > 0)
          .reduce((sum, t) => sum + t.monto, 0);
        const totalWalletEgresos = Math.abs(data.collectorWalletTransactions
          .filter(t => t.monto < 0)
          .reduce((sum, t) => sum + t.monto, 0));
        
        const totalPagos = data.paymentsYesterday.reduce((sum, p) => sum + p.monto, 0);

        const summaryItems = [
          { label: 'Transacciones Caja Fuerte', value: data.safeTransactions.length, color: '#3498db', detail: `Ingresos: $${totalSafeIngresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })} | Egresos: $${totalSafeEgresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
          { label: 'Transacciones Wallet Cobros', value: data.collectorWalletTransactions.length, color: '#9b59b6', detail: `Ingresos: $${totalWalletIngresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })} | Egresos: $${totalWalletEgresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
          { label: 'Clientes Activos', value: data.clients.length, color: '#27ae60' },
          { label: 'Préstamos con Actividad', value: data.loans.length, color: '#e67e22' },
          { label: 'Pagos Realizados', value: data.paymentsYesterday.length, color: '#e74c3c', detail: `Total: $${totalPagos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
        ];

        summaryItems.forEach((item, index) => {
          if (doc.y > doc.page.height - 80) {
            doc.addPage();
            addFooter();
          }
          doc.fillColor(item.color)
            .circle(50, doc.y + 5, 4)
            .fill();
          doc.fillColor('#2c3e50')
            .font('Helvetica')
            .text(`${item.label}:`, 65, doc.y);
          doc.font('Helvetica-Bold')
            .text(`${item.value}`, doc.page.width - 150, doc.y);
          
          if (item.detail) {
            doc.moveDown(0.2);
            doc.fontSize(8)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(item.detail, 65, doc.y, { width: doc.page.width - 100 });
          }
          
          doc.moveDown(0.4);
        });

        doc.moveDown(0.5);

        // Balances Totales del Sistema
        addSectionHeader('BALANCES TOTALES DEL SISTEMA');
        
        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Total Cajas Fuertes:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#3498db')
          .text(`$${data.totalSafeBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Total Wallets de Cobros:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#9b59b6')
          .text(`$${data.totalCollectorWalletBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Total Préstamos Activos:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#e67e22')
          .text(`${data.totalActiveLoans} préstamos`, 250, doc.y);
        doc.moveDown(0.3);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Monto Total en Préstamos:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#e67e22')
          .text(`$${data.totalLoansAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        // Balance consolidado
        const balanceConsolidado = data.totalSafeBalance + data.totalCollectorWalletBalance;
        doc.moveTo(40, doc.y)
          .lineTo(doc.page.width - 40, doc.y)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.3);
        
        doc.fontSize(11)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Consolidado (Cajas Fuertes + Wallets):', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#27ae60')
          .text(`$${balanceConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 400, doc.y);

        doc.moveDown(0.5);

        // Sección 2: Transacciones Caja Fuerte (formato lista)
        if (data.safeTransactions.length > 0) {
          addSectionHeader(`CAJA FUERTE - HISTORIAL DEL ${previousDate.toFormat('dd/MM/yyyy')}`);
          
          data.safeTransactions.forEach((t, index) => {
            if (doc.y > doc.page.height - 120) {
              doc.addPage();
            }

            // Fondo alternado para mejor legibilidad
            if (index % 2 === 0) {
              doc.rect(40, doc.y - 5, doc.page.width - 80, 50)
                .fillColor('#f8f9fa')
                .fill();
            }

            // Tipo y fecha
            doc.fontSize(10)
              .fillColor('#2c3e50')
              .font('Helvetica-Bold')
              .text(`${t.tipo}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`${t.fecha}`, doc.page.width - 150, doc.y);
            
            doc.moveDown(0.3);

            // Descripción
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Descripción: ${t.descripcion}`, 50, doc.y, { width: doc.page.width - 100 });
            
            if (t.categoriaGasto) {
              doc.text(`Categoría: ${t.categoriaGasto}`, 50, doc.y, { width: doc.page.width - 100 });
            }

            doc.moveDown(0.2);

            // Monto y saldos
            const montoColor = t.monto >= 0 ? '#27ae60' : '#e74c3c';
            doc.fontSize(10)
              .fillColor(montoColor)
              .font('Helvetica-Bold')
              .text(`Monto: $${t.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Saldo Anterior: $${t.saldoAnterior.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 200, doc.y);
            
            doc.text(`Saldo Posterior: $${t.saldoPosterior.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 350, doc.y);
            
            doc.moveDown(0.2);

            // Usuario
            doc.fontSize(8)
              .fillColor('#95a5a6')
              .font('Helvetica')
              .text(`Usuario: ${t.usuario}`, 50, doc.y);

            doc.moveDown(0.6);
          });
        } else {
          addSectionHeader(`CAJA FUERTE - HISTORIAL DEL ${previousDate.toFormat('dd/MM/yyyy')}`);
          doc.fontSize(10)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text('No se registraron transacciones en este período.', 50, doc.y);
          doc.moveDown(0.5);
        }

        // Sección 3: Transacciones Wallet Cobros (formato lista)
        if (data.collectorWalletTransactions.length > 0) {
          addSectionHeader(`WALLET DE COBROS - HISTORIAL DEL ${previousDate.toFormat('dd/MM/yyyy')}`);
          
          data.collectorWalletTransactions.forEach((t, index) => {
            if (doc.y > doc.page.height - 120) {
              doc.addPage();
            }

            // Fondo alternado
            if (index % 2 === 0) {
              doc.rect(40, doc.y - 5, doc.page.width - 80, 50)
                .fillColor('#f8f9fa')
                .fill();
            }

            // Tipo y fecha
            doc.fontSize(10)
              .fillColor('#2c3e50')
              .font('Helvetica-Bold')
              .text(`${t.tipo}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`${t.fecha}`, doc.page.width - 150, doc.y);
            
            doc.moveDown(0.3);

            // Descripción
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Descripción: ${t.descripcion}`, 50, doc.y, { width: doc.page.width - 100 });

            doc.moveDown(0.2);

            // Monto y saldos
            const montoColor = t.monto >= 0 ? '#27ae60' : '#e74c3c';
            doc.fontSize(10)
              .fillColor(montoColor)
              .font('Helvetica-Bold')
              .text(`Monto: $${t.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Saldo Anterior: $${t.saldoAnterior.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 200, doc.y);
            
            doc.text(`Saldo Posterior: $${t.saldoPosterior.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 350, doc.y);
            
            doc.moveDown(0.2);

            // Usuario
            doc.fontSize(8)
              .fillColor('#95a5a6')
              .font('Helvetica')
              .text(`Usuario: ${t.usuario}`, 50, doc.y);

            doc.moveDown(0.6);
          });
        } else {
          addSectionHeader(`WALLET DE COBROS - HISTORIAL DEL ${previousDate.toFormat('dd/MM/yyyy')}`);
          doc.fontSize(10)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text('No se registraron transacciones en este período.', 50, doc.y);
          doc.moveDown(0.5);
        }

        // Sección 4: Préstamos con Actividad (formato lista)
        if (data.loans.length > 0) {
          addSectionHeader('PRÉSTAMOS CON ACTIVIDAD');
          
          data.loans.forEach((l, index) => {
            if (doc.y > doc.page.height - 140) {
              doc.addPage();
            }

            // Fondo alternado
            if (index % 2 === 0) {
              doc.rect(40, doc.y - 5, doc.page.width - 80, 70)
                .fillColor('#f8f9fa')
                .fill();
            }

            // Número de préstamo
            doc.fontSize(11)
              .fillColor('#2c3e50')
              .font('Helvetica-Bold')
              .text(`Préstamo: ${l.numeroPrestamo}`, 50, doc.y);
            
            doc.moveDown(0.3);

            // Cliente y DNI
            doc.fontSize(10)
              .fillColor('#34495e')
              .font('Helvetica-Bold')
              .text(`Cliente: ${l.cliente}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`DNI: ${l.dni}`, 250, doc.y);
            
            doc.moveDown(0.3);

            // Montos
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Monto Original: $${l.montoOriginal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 50, doc.y);
            
            doc.text(`Monto Total: $${l.montoTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
            
            doc.text(`Tasa Interés: ${l.tasaInteres}%`, 400, doc.y);
            
            doc.moveDown(0.3);

            // Estado de cuotas
            doc.fontSize(9)
              .fillColor('#e67e22')
              .font('Helvetica-Bold')
              .text(`Cuotas: ${l.resumen} (${l.cuotasPendientes} pendientes)`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#27ae60')
              .font('Helvetica-Bold')
              .text(`Pagos realizados ayer: ${l.pagosAyer}`, 300, doc.y);

            doc.moveDown(0.6);
          });
        } else {
          addSectionHeader('PRÉSTAMOS CON ACTIVIDAD');
          doc.fontSize(10)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text('No hay préstamos con actividad en este período.', 50, doc.y);
          doc.moveDown(0.5);
        }

        // Sección 5: Pagos del Día Anterior (formato lista)
        if (data.paymentsYesterday.length > 0) {
          addSectionHeader(`PAGOS REALIZADOS EL ${previousDate.toFormat('dd/MM/yyyy')}`);
          
          // Resumen de pagos
          const totalPagos = data.paymentsYesterday.reduce((sum, p) => sum + p.monto, 0);
          doc.fontSize(10)
            .fillColor('#27ae60')
            .font('Helvetica-Bold')
            .text(`Total de pagos: ${data.paymentsYesterday.length} | Monto total: $${totalPagos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 50, doc.y);
          doc.moveDown(0.5);
          
          data.paymentsYesterday.forEach((p, index) => {
            if (doc.y > doc.page.height - 120) {
              doc.addPage();
            }

            // Fondo alternado
            if (index % 2 === 0) {
              doc.rect(40, doc.y - 5, doc.page.width - 80, 60)
                .fillColor('#f8f9fa')
                .fill();
            }

            // Fecha y monto destacado
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`${p.fecha}`, 50, doc.y);
            
            doc.fontSize(11)
              .fillColor('#27ae60')
              .font('Helvetica-Bold')
              .text(`$${p.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, doc.page.width - 150, doc.y);
            
            doc.moveDown(0.3);

            // Cliente y préstamo
            doc.fontSize(10)
              .fillColor('#2c3e50')
              .font('Helvetica-Bold')
              .text(`${p.cliente}`, 50, doc.y);
            
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`DNI: ${p.dni}`, 250, doc.y);
            
            doc.moveDown(0.2);

            // Detalles del préstamo
            doc.fontSize(9)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Préstamo: ${p.numeroPrestamo} | Cuota: ${p.numeroCuota}`, 50, doc.y);
            
            doc.moveDown(0.2);

            // Descripción
            if (p.descripcion && p.descripcion !== 'Pago de cuota') {
              doc.fontSize(8)
                .fillColor('#95a5a6')
                .font('Helvetica')
                .text(`Descripción: ${p.descripcion}`, 50, doc.y, { width: doc.page.width - 100 });
            }

            doc.moveDown(0.6);
          });
        } else {
          addSectionHeader(`PAGOS REALIZADOS EL ${previousDate.toFormat('dd/MM/yyyy')}`);
          doc.fontSize(10)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text('No se registraron pagos en este período.', 50, doc.y);
          doc.moveDown(0.5);
        }

        // Sección 6: Resumen de Clientes
        addSectionHeader(`CLIENTES ACTIVOS (Total: ${data.clients.length})`);
        
        doc.fontSize(9)
          .fillColor('#34495e')
          .font('Helvetica')
          .text(`Total de clientes activos en el sistema: ${data.clients.length}`, 50, doc.y);
        
        doc.moveDown(0.5);

        // Mostrar solo los primeros 30 clientes en formato compacto
        const clientsToShow = data.clients.slice(0, 30);
        
        clientsToShow.forEach((c, index) => {
          if (doc.y > doc.page.height - 60) {
            doc.addPage();
          }

          if (index % 2 === 0) {
            doc.rect(40, doc.y - 3, doc.page.width - 80, 25)
              .fillColor('#f8f9fa')
              .fill();
          }

          doc.fontSize(9)
            .fillColor('#2c3e50')
            .font('Helvetica-Bold')
            .text(c.nombre, 50, doc.y);
          
          doc.fontSize(8)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text(`DNI: ${c.dni} | CUIT: ${c.cuit}`, 250, doc.y);
          
          if (c.managers) {
            doc.text(`Manager: ${c.managers}`, 450, doc.y);
          }

          doc.moveDown(0.4);
        });

        if (data.clients.length > 30) {
          doc.moveDown(0.3);
          doc.fontSize(9)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text(`... y ${data.clients.length - 30} clientes más (total: ${data.clients.length})`, 50, doc.y, { align: 'center' });
        }

        // Agregar pie de página después de finalizar el documento
        doc.on('pageAdded', (page: any) => {
          // No agregar footer aquí para evitar loops
        });

        doc.end();

        // Agregar pie de página después de que el documento termine
        // Esto se hace en el evento 'end'
        doc.on('end', () => {
          // El footer ya se agregó durante la generación
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Agrega una tabla al PDF
   */
  private addTable(doc: any, rows: string[][]) {
    const startY = doc.y;
    const pageWidth = doc.page.width - 100; // Margen izquierdo y derecho
    const colCount = rows[0].length;
    const colWidth = pageWidth / colCount;
    const rowHeight = 20;
    const fontSize = 8;

    rows.forEach((row, rowIndex) => {
      // Verificar si necesitamos una nueva página
      if (doc.y + rowHeight > doc.page.height - 50) {
        doc.addPage();
      }

      const isHeader = rowIndex === 0;
      doc.fontSize(fontSize).font(isHeader ? 'Helvetica-Bold' : 'Helvetica');

      row.forEach((cell, colIndex) => {
        const x = 50 + (colIndex * colWidth);
        const y = doc.y;
        const cellText = cell || '';

        // Dibujar borde
        doc.rect(x, y, colWidth, rowHeight).stroke();

        // Agregar texto (truncar si es muy largo)
        const maxWidth = colWidth - 4;
        const truncatedText = doc.heightOfString(cellText, { width: maxWidth }) > rowHeight
          ? cellText.substring(0, 20) + '...'
          : cellText;

        doc.text(truncatedText, x + 2, y + (rowHeight - fontSize) / 2, {
          width: maxWidth,
          height: rowHeight,
          align: 'left',
        });
      });

      doc.moveDown(rowHeight / 12);
    });
  }

  /**
   * Genera el PDF del reporte semanal con diseño profesional y visión general
   */
  private async generateWeeklyPDF(data: {
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
    safeTransactions: any[];
    collectorWalletTransactions: any[];
    clients: any[];
    loans: any[];
    paymentsWeek: any[];
    totalSafeBalance: number;
    totalCollectorWalletBalance: number;
    totalActiveLoans: number;
    totalLoansAmount: number;
  }): Promise<{ pdfBase64: string; filename: string }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 60, bottom: 60, left: 40, right: 40 },
        });

        const chunks: Buffer[] = [];
        const weekStart = DateTime.fromISO(data.weekStart);
        const weekEnd = DateTime.fromISO(data.weekEnd);

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          const pdfBase64 = pdfBuffer.toString('base64');
          // Formato: reporte-semanal-YYYY-MM-DD.pdf (fecha del domingo, fin de semana)
          const filename = `reporte-semanal-${data.weekEnd}.pdf`;
          resolve({ pdfBase64, filename });
        });
        doc.on('error', reject);

        // Función helper para agregar pie de página
        const addFooter = (pageNumber?: number) => {
          const currentPage = pageNumber || (doc.bufferedPageRange()?.count || 1);
          const footerY = doc.page.height - 40;
          doc.fontSize(8)
            .fillColor('#666666')
            .text(
              `Página ${currentPage} | Generado el ${DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm')} hs`,
              40,
              footerY,
              { align: 'center', width: doc.page.width - 80 }
            );
        };

        // Función helper para agregar encabezado de sección
        const addSectionHeader = (title: string) => {
          if (doc.y > doc.page.height - 100) {
            doc.addPage();
          }
          doc.moveDown(1);
          doc.fontSize(14)
            .fillColor('#1a1a1a')
            .font('Helvetica-Bold')
            .text(title, { underline: false });
          doc.moveDown(0.3);
          // Línea decorativa
          doc.moveTo(40, doc.y)
            .lineTo(doc.page.width - 40, doc.y)
            .strokeColor('#cccccc')
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.5);
        };

        // Encabezado principal
        doc.rect(0, 0, doc.page.width, 80)
          .fillColor('#34495e')
          .fill();
        
        doc.fontSize(24)
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .text('REPORTE SEMANAL', 40, 30, { align: 'left' });
        
        doc.fontSize(12)
          .fillColor('#ecf0f1')
          .font('Helvetica')
          .text(`Período: ${data.weekLabel}`, 40, 55, { align: 'left' });
        
        doc.fontSize(10)
          .fillColor('#bdc3c7')
          .text(`Del ${weekStart.toFormat('dd/MM/yyyy')} al ${weekEnd.toFormat('dd/MM/yyyy')}`, 40, 70, { align: 'left' });

        doc.y = 100;

        // Resumen Ejecutivo Semanal
        addSectionHeader('RESUMEN EJECUTIVO SEMANAL');
        doc.fontSize(10).fillColor('#2c3e50').font('Helvetica');
        
        // Calcular totales semanales
        const totalSafeIngresos = data.safeTransactions
          .filter(t => t.monto > 0)
          .reduce((sum, t) => sum + t.monto, 0);
        const totalSafeEgresos = Math.abs(data.safeTransactions
          .filter(t => t.monto < 0)
          .reduce((sum, t) => sum + t.monto, 0));
        
        const totalWalletIngresos = data.collectorWalletTransactions
          .filter(t => t.monto > 0)
          .reduce((sum, t) => sum + t.monto, 0);
        const totalWalletEgresos = Math.abs(data.collectorWalletTransactions
          .filter(t => t.monto < 0)
          .reduce((sum, t) => sum + t.monto, 0));
        
        const totalPagos = data.paymentsWeek.reduce((sum, p) => sum + p.monto, 0);
        const totalPrestamosNuevos = data.loans.filter(l => {
          const loanDate = DateTime.fromISO(data.weekStart);
          // Asumimos que los préstamos nuevos son los que tienen actividad esta semana
          return l.pagosSemana > 0;
        }).length;

        const summaryItems = [
          { label: 'Transacciones Caja Fuerte', value: data.safeTransactions.length, color: '#3498db', detail: `Ingresos: $${totalSafeIngresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })} | Egresos: $${totalSafeEgresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
          { label: 'Transacciones Wallet Cobros', value: data.collectorWalletTransactions.length, color: '#9b59b6', detail: `Ingresos: $${totalWalletIngresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })} | Egresos: $${totalWalletEgresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
          { label: 'Clientes Activos', value: data.clients.length, color: '#27ae60' },
          { label: 'Préstamos con Actividad', value: data.loans.length, color: '#e67e22' },
          { label: 'Pagos Realizados', value: data.paymentsWeek.length, color: '#e74c3c', detail: `Total: $${totalPagos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
        ];

        summaryItems.forEach((item) => {
          if (doc.y > doc.page.height - 80) {
            doc.addPage();
          }
          doc.fillColor(item.color)
            .circle(50, doc.y + 5, 4)
            .fill();
          doc.fillColor('#2c3e50')
            .font('Helvetica')
            .text(`${item.label}:`, 65, doc.y);
          doc.font('Helvetica-Bold')
            .text(`${item.value}`, doc.page.width - 150, doc.y);
          
          if (item.detail) {
            doc.moveDown(0.2);
            doc.fontSize(8)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(item.detail, 65, doc.y, { width: doc.page.width - 100 });
          }
          
          doc.moveDown(0.4);
        });

        doc.moveDown(0.5);

        // Balances Totales del Sistema
        addSectionHeader('BALANCES TOTALES DEL SISTEMA');
        
        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Total Cajas Fuertes:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#3498db')
          .text(`$${data.totalSafeBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Total Wallets de Cobros:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#9b59b6')
          .text(`$${data.totalCollectorWalletBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Total Préstamos Activos:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#e67e22')
          .text(`${data.totalActiveLoans} préstamos`, 250, doc.y);
        doc.moveDown(0.3);

        doc.fontSize(10)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Monto Total en Préstamos:', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#e67e22')
          .text(`$${data.totalLoansAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 250, doc.y);
        doc.moveDown(0.4);

        // Balance consolidado
        const balanceConsolidado = data.totalSafeBalance + data.totalCollectorWalletBalance;
        doc.moveTo(40, doc.y)
          .lineTo(doc.page.width - 40, doc.y)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.3);
        
        doc.fontSize(11)
          .fillColor('#2c3e50')
          .font('Helvetica-Bold')
          .text('Balance Consolidado (Cajas Fuertes + Wallets):', 50, doc.y);
        doc.font('Helvetica-Bold')
          .fillColor('#27ae60')
          .text(`$${balanceConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 400, doc.y);

        // Resumen de Préstamos (solo los más importantes)
        if (data.loans.length > 0) {
          addSectionHeader('PRÉSTAMOS CON ACTIVIDAD (Resumen)');
          
          // Mostrar solo los primeros 20 préstamos
          const loansToShow = data.loans.slice(0, 20);
          
          loansToShow.forEach((l, index) => {
            if (doc.y > doc.page.height - 100) {
              doc.addPage();
            }

            if (index % 2 === 0) {
              doc.rect(40, doc.y - 3, doc.page.width - 80, 40)
                .fillColor('#f8f9fa')
                .fill();
            }

            doc.fontSize(9)
              .fillColor('#2c3e50')
              .font('Helvetica-Bold')
              .text(`${l.numeroPrestamo} - ${l.cliente}`, 50, doc.y);
            
            doc.fontSize(8)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`Cuotas: ${l.resumen} | Pagos esta semana: ${l.pagosSemana}`, 50, doc.y + 12);
            
            doc.fontSize(8)
              .fillColor('#34495e')
              .font('Helvetica')
              .text(`Monto: $${l.montoTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, 350, doc.y);

            doc.moveDown(0.5);
          });

          if (data.loans.length > 20) {
            doc.moveDown(0.3);
            doc.fontSize(9)
              .fillColor('#7f8c8d')
              .font('Helvetica')
              .text(`... y ${data.loans.length - 20} préstamos más (total: ${data.loans.length})`, 50, doc.y, { align: 'center' });
          }
        }

        // Resumen de Pagos (solo totales por día)
        if (data.paymentsWeek.length > 0) {
          addSectionHeader('RESUMEN DE PAGOS SEMANALES');
          
          // Agrupar pagos por día
          const paymentsByDay = new Map<string, { count: number; total: number }>();
          data.paymentsWeek.forEach(p => {
            const day = p.fecha.split(' ')[0]; // Obtener solo la fecha
            const existing = paymentsByDay.get(day) || { count: 0, total: 0 };
            existing.count += 1;
            existing.total += p.monto;
            paymentsByDay.set(day, existing);
          });

          doc.fontSize(9)
            .fillColor('#2c3e50')
            .font('Helvetica-Bold')
            .text('Día', 50, doc.y);
          doc.text('Cantidad', 200, doc.y);
          doc.text('Total', 350, doc.y);
          doc.moveDown(0.3);

          Array.from(paymentsByDay.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([day, stats]) => {
              if (doc.y > doc.page.height - 80) {
                doc.addPage();
              }

              doc.fontSize(9)
                .fillColor('#34495e')
                .font('Helvetica')
                .text(day, 50, doc.y);
              
              doc.text(stats.count.toString(), 200, doc.y);
              
              doc.font('Helvetica-Bold')
                .fillColor('#27ae60')
                .text(`$${stats.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, 350, doc.y);

              doc.moveDown(0.4);
            });

          doc.moveDown(0.3);
          doc.moveTo(40, doc.y)
            .lineTo(doc.page.width - 40, doc.y)
            .strokeColor('#cccccc')
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.3);

          doc.fontSize(10)
            .fillColor('#2c3e50')
            .font('Helvetica-Bold')
            .text('Total Semanal:', 50, doc.y);
          doc.font('Helvetica-Bold')
            .fillColor('#27ae60')
            .text(`$${totalPagos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 350, doc.y);
        }

        // Agregar pie de página
        addFooter(1);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Formatea una fecha
   */
  private formatDate(dateStr: string): string {
    const date = DateTime.fromISO(dateStr).setZone('America/Argentina/Buenos_Aires');
    return date.toFormat('dd/MM/yyyy');
  }
}

