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

      // NOTA: El envío automático por email y guardado en bucket ha sido deshabilitado.
      // Los reportes ahora se generan bajo demanda a través del endpoint de la API.

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

      // NOTA: El envío automático por email y guardado en bucket ha sido deshabilitado.
      // Los reportes ahora se generan bajo demanda a través del endpoint de la API.

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

  /**
   * Genera reporte PDF de movimientos de managers para un subadmin
   * Solo accesible por el subadmin mismo
   */
  async generateSubadminManagersReport(
    subadminId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ success: boolean; pdfBase64?: string; filename?: string; error?: string }> {
    try {
      // Convertir fechas a DateTime en zona horaria Buenos Aires
      const startDt = DateUtil.parseToDate(startDate);
      const endDt = DateUtil.parseToDate(endDate);
      
      const startDateTime = DateUtil.fromJSDate(startDt).startOf('day');
      const endDateTime = DateUtil.fromJSDate(endDt).endOf('day');
      
      const startDateJS = startDateTime.toJSDate();
      const endDateJS = endDateTime.toJSDate();

      this.logger.log(
        `Generando reporte de managers para subadmin ${subadminId} desde ${startDate} hasta ${endDate}`,
      );

      // Obtener todos los managers creados por este subadmin
      const managers = await this.prisma.user.findMany({
        where: {
          createdById: subadminId,
          role: 'MANAGER',
          deletedAt: null,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      });

      if (managers.length === 0) {
        return {
          success: false,
          error: 'No se encontraron managers asociados a este subadmin',
        };
      }

      const managerIds = managers.map((m) => m.id);

      // Obtener todas las transacciones de collector wallet de estos managers en el período
      const wallets = await this.prisma.collectorWallet.findMany({
        where: {
          userId: { in: managerIds },
        },
        select: { id: true, userId: true },
      });

      const walletIds = wallets.map((w) => w.id);

      const transactions = await this.prisma.collectorWalletTransaction.findMany({
        where: {
          walletId: { in: walletIds },
          createdAt: {
            gte: startDateJS,
            lte: endDateJS,
          },
        },
        include: {
          wallet: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Obtener información de subloans para transacciones que tienen subLoanId
      const subLoanIds = transactions
        .filter((tx) => tx.subLoanId)
        .map((tx) => tx.subLoanId!);
      
      // Eliminar duplicados
      const uniqueSubLoanIds = [...new Set(subLoanIds)];
      
      const subLoansWithLoans = uniqueSubLoanIds.length > 0
        ? await this.prisma.subLoan.findMany({
            where: { id: { in: uniqueSubLoanIds } },
            include: {
              loan: {
                include: {
                  client: {
                    select: {
                      fullName: true,
                    },
                  },
                },
              },
            },
          })
        : [];

      // Crear un mapa de subLoanId -> subLoan para acceso rápido
      const subLoanMap = new Map(
        subLoansWithLoans.map((sl) => [sl.id, sl])
      );

      // Obtener información de préstamos desembolsados en el período
      const loansDisbursed = await this.prisma.loan.findMany({
        where: {
          managerId: { in: managerIds },
          createdAt: {
            gte: startDateJS,
            lte: endDateJS,
          },
          deletedAt: null,
        },
        include: {
          client: {
            select: {
              fullName: true,
              dni: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Obtener transacciones de safe de todos los managers del subadmin en el período
      // Primero obtener los safes de los managers
      const managerSafes = await this.prisma.safe.findMany({
        where: {
          userId: { in: managerIds },
        },
        select: { id: true },
      });

      const safeIds = managerSafes.map((s) => s.id);

      const safeTransactions = safeIds.length > 0
        ? await this.prisma.safeTransaction.findMany({
            where: {
              safeId: { in: safeIds },
              createdAt: {
                gte: startDateJS,
                lte: endDateJS,
              },
            },
            include: {
              safe: {
                include: {
                  user: {
                    select: {
                      fullName: true,
                      email: true,
                    },
                  },
                },
              },
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
          })
        : [];

      // Agrupar transacciones por manager
      const transactionsByManager = new Map<string, any[]>();
      managers.forEach((manager) => {
        transactionsByManager.set(manager.id, []);
      });

      transactions.forEach((tx) => {
        const managerId = tx.wallet.userId;
        if (transactionsByManager.has(managerId)) {
          // Agregar información del subLoan si existe
          const enrichedTx = {
            ...tx,
            subLoan: tx.subLoanId ? subLoanMap.get(tx.subLoanId) : null,
          };
          transactionsByManager.get(managerId)!.push(enrichedTx);
        }
      });

      // Agrupar transacciones de safe por manager
      const safeTransactionsByManager = new Map<string, any[]>();
      managers.forEach((manager) => {
        safeTransactionsByManager.set(manager.id, []);
      });

      safeTransactions.forEach((tx) => {
        const managerId = tx.safe.userId;
        if (safeTransactionsByManager.has(managerId)) {
          safeTransactionsByManager.get(managerId)!.push(tx);
        }
      });

      // Generar PDF
      const { pdfBase64, filename } = await this.generateSubadminManagersPDF({
        subadminId,
        startDate: startDate,
        endDate: endDate,
        managers,
        transactionsByManager,
        loansDisbursed,
        safeTransactionsByManager,
      });

      return {
        success: true,
        pdfBase64,
        filename,
      };
    } catch (error: any) {
      this.logger.error('Error al generar reporte de managers:', error);
      return {
        success: false,
        error: error.message || 'Error desconocido',
      };
    }
  }

  /**
   * Traduce el tipo de transacción a español
   */
  private translateTransactionType(type: string): string {
    const translations: Record<string, string> = {
      COLLECTION: 'Cobros',
      WITHDRAWAL: 'Retiros',
      ROUTE_EXPENSE: 'Gastos de Ruta',
      LOAN_DISBURSEMENT: 'Desembolsos',
      CASH_ADJUSTMENT: 'Ajustes de Caja',
      PAYMENT_RESET: 'Reseteos de Pago',
      // Safe transaction types
      DEPOSIT: 'Depósitos',
      EXPENSE: 'Gastos',
      TRANSFER_TO_COLLECTOR: 'Transferencia a Cobrador',
      TRANSFER_FROM_COLLECTOR: 'Transferencia desde Cobrador',
      TRANSFER_TO_SAFE: 'Transferencia a Caja Fuerte',
      TRANSFER_FROM_SAFE: 'Transferencia desde Caja Fuerte',
    };
    return translations[type] || type;
  }

  /**
   * Genera el PDF del reporte de managers con diseño profesional
   */
  private async generateSubadminManagersPDF(data: {
    subadminId: string;
    startDate: string;
    endDate: string;
    managers: Array<{ id: string; fullName: string; email: string }>;
    transactionsByManager: Map<string, any[]>;
    loansDisbursed: any[];
    safeTransactionsByManager: Map<string, any[]>;
  }): Promise<{ pdfBase64: string; filename: string }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 60, bottom: 60, left: 40, right: 40 },
        });

        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          const pdfBase64 = pdfBuffer.toString('base64');
          const filename = `reporte-managers-${data.startDate}-${data.endDate}.pdf`;
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
            addFooter();
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
          .fillColor('#2c3e50')
          .fill();
        
        doc.fontSize(24)
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .text('REPORTE DE MANAGERS', 40, 30, { align: 'left' });
        
        doc.fontSize(12)
          .fillColor('#ecf0f1')
          .font('Helvetica')
          .text(
            `Período: ${this.formatDate(data.startDate)} - ${this.formatDate(data.endDate)}`,
            40,
            55,
            { align: 'left' }
          );
        
        doc.fontSize(10)
          .fillColor('#bdc3c7')
          .text(
            `Total de Managers: ${data.managers.length}`,
            40,
            70,
            { align: 'left' }
          );

        doc.y = 100;

        // Resumen Ejecutivo
        addSectionHeader('RESUMEN EJECUTIVO');
        
        let totalCollections = 0;
        let totalDisbursements = 0;
        let totalExpenses = 0;
        let totalResets = 0;
        let totalWithdrawals = 0;
        let totalAdjustments = 0;

        data.transactionsByManager.forEach((transactions) => {
          transactions.forEach((tx) => {
            const amount = Number(tx.amount);
            switch (tx.type) {
              case 'COLLECTION':
                totalCollections += amount;
                break;
              case 'LOAN_DISBURSEMENT':
                totalDisbursements += Math.abs(amount);
                break;
              case 'ROUTE_EXPENSE':
                totalExpenses += Math.abs(amount);
                break;
              case 'PAYMENT_RESET':
                totalResets += Math.abs(amount);
                break;
              case 'WITHDRAWAL':
                totalWithdrawals += Math.abs(amount);
                break;
              case 'CASH_ADJUSTMENT':
                totalAdjustments += amount;
                break;
            }
          });
        });

        // Calcular totales de safe
        let totalSafeDeposits = 0;
        let totalSafeWithdrawals = 0;
        let totalSafeExpenses = 0;
        let totalSafeTransfersOut = 0;
        let totalSafeTransfersIn = 0;

        data.safeTransactionsByManager.forEach((transactions) => {
          transactions.forEach((tx) => {
            const amount = Number(tx.amount);
            switch (tx.type) {
              case 'DEPOSIT':
                totalSafeDeposits += amount;
                break;
              case 'WITHDRAWAL':
                totalSafeWithdrawals += Math.abs(amount);
                break;
              case 'EXPENSE':
                totalSafeExpenses += Math.abs(amount);
                break;
              case 'TRANSFER_TO_COLLECTOR':
              case 'TRANSFER_TO_SAFE':
                totalSafeTransfersOut += Math.abs(amount);
                break;
              case 'TRANSFER_FROM_COLLECTOR':
              case 'TRANSFER_FROM_SAFE':
                totalSafeTransfersIn += amount;
                break;
            }
          });
        });

        const netAmount = totalCollections - totalDisbursements - totalExpenses - totalWithdrawals + totalAdjustments - totalResets;
        const netSafeAmount = totalSafeDeposits + totalSafeTransfersIn - totalSafeWithdrawals - totalSafeExpenses - totalSafeTransfersOut;

        doc.fontSize(10).fillColor('#2c3e50').font('Helvetica');
        
        const summaryData = [
          { label: 'Total Cobrado', value: `$${totalCollections.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#27ae60' },
          { label: 'Total Prestado', value: `$${totalDisbursements.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#e67e22' },
          { label: 'Total Gastado', value: `$${totalExpenses.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#e74c3c' },
          { label: 'Total Retirado', value: `$${totalWithdrawals.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#c0392b' },
          { label: 'Total Resets', value: `$${totalResets.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#95a5a6' },
          { label: 'Ajustes de Caja', value: `$${totalAdjustments.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#3498db' },
          { label: 'NETO', value: `$${netAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, color: '#2c3e50', bold: true },
        ];

        summaryData.forEach((item) => {
          if (doc.y > doc.page.height - 80) {
            doc.addPage();
            addFooter();
          }
          doc.fillColor(item.color)
            .circle(50, doc.y + 5, 4)
            .fill();
          doc.fillColor('#2c3e50')
            .font(item.bold ? 'Helvetica-Bold' : 'Helvetica')
            .text(`${item.label}:`, 65, doc.y);
          doc.font(item.bold ? 'Helvetica-Bold' : 'Helvetica')
            .text(item.value, doc.page.width - 200, doc.y, { align: 'right' });
          doc.moveDown(0.4);
        });

        // Sección de Préstamos Desembolsados
        if (data.loansDisbursed.length > 0) {
          addSectionHeader('PRÉSTAMOS DESEMBOLSADOS');
          
          doc.fontSize(9).fillColor('#2c3e50').font('Helvetica');
          doc.text(`Total de préstamos: ${data.loansDisbursed.length}`, 40, doc.y);
          doc.moveDown(0.5);

          // Tabla de préstamos
          const loanRowHeight = 25;
          const loanColWidths = {
            fecha: 80,
            cliente: 180,
            track: 120,
            monto: 100,
          };

          // Encabezado de tabla de préstamos
          doc.fontSize(8)
            .fillColor('#ffffff')
            .font('Helvetica-Bold');
          doc.rect(40, doc.y, doc.page.width - 80, loanRowHeight)
            .fillColor('#34495e')
            .fill();
          doc.text('Fecha', 45, doc.y + 8);
          doc.text('Cliente', 45 + loanColWidths.fecha, doc.y + 8);
          doc.text('Nro. Préstamo', 45 + loanColWidths.fecha + loanColWidths.cliente, doc.y + 8);
          doc.text('Monto', doc.page.width - 45 - loanColWidths.monto, doc.y + 8, { align: 'right' });
          doc.y += loanRowHeight;

          // Filas de préstamos
          data.loansDisbursed.forEach((loan) => {
            if (doc.y > doc.page.height - 100) {
              doc.addPage();
              addFooter();
            }

            const fecha = DateTime.fromJSDate(loan.createdAt)
              .setZone('America/Argentina/Buenos_Aires')
              .toFormat('dd/MM/yyyy HH:mm');
            const amount = Number(loan.amount);

            doc.fontSize(8)
              .fillColor('#2c3e50')
              .font('Helvetica');
            
            doc.text(fecha, 45, doc.y + 6);
            doc.text(loan.client?.fullName || 'N/A', 45 + loanColWidths.fecha, doc.y + 6, {
              width: loanColWidths.cliente,
              ellipsis: true,
            });
            doc.text(loan.loanTrack || 'N/A', 45 + loanColWidths.fecha + loanColWidths.cliente, doc.y + 6, {
              width: loanColWidths.track,
              ellipsis: true,
            });
            doc.text(
              `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
              doc.page.width - 45 - loanColWidths.monto,
              doc.y + 6,
              { align: 'right' }
            );

            // Línea separadora
            doc.moveTo(40, doc.y + loanRowHeight - 2)
              .lineTo(doc.page.width - 40, doc.y + loanRowHeight - 2)
              .strokeColor('#ecf0f1')
              .lineWidth(0.5)
              .stroke();

            doc.y += loanRowHeight;
          });

          doc.moveDown(0.5);
        }

        // Detalle por Manager
        data.managers.forEach((manager) => {
          const managerTransactions = data.transactionsByManager.get(manager.id) || [];
          const managerSafeTransactions = data.safeTransactionsByManager.get(manager.id) || [];
          
          // Skip managers sin transacciones de wallet ni de safe
          if (managerTransactions.length === 0 && managerSafeTransactions.length === 0) {
            return;
          }

          addSectionHeader(`MANAGER: ${manager.fullName.toUpperCase()}`);
          
          doc.fontSize(9)
            .fillColor('#7f8c8d')
            .font('Helvetica')
            .text(`Email: ${manager.email}`, 40, doc.y);
          doc.moveDown(0.3);
          doc.text(`Transacciones Wallet: ${managerTransactions.length} | Transacciones Caja Fuerte: ${managerSafeTransactions.length}`, 40, doc.y);
          doc.moveDown(0.5);

          // Tabla de transacciones
          let yStart = doc.y;
          const rowHeight = 20;
          const colWidths = {
            fecha: 80,
            tipo: 100,
            descripcion: 200,
            monto: 100,
          };

          // Encabezado de tabla
          doc.fontSize(8)
            .fillColor('#ffffff')
            .font('Helvetica-Bold');
          doc.rect(40, doc.y, doc.page.width - 80, rowHeight)
            .fillColor('#34495e')
            .fill();
          doc.text('Fecha', 45, doc.y + 6);
          doc.text('Tipo', 45 + colWidths.fecha, doc.y + 6);
          doc.text('Descripción', 45 + colWidths.fecha + colWidths.tipo, doc.y + 6);
          doc.text('Monto', doc.page.width - 45 - colWidths.monto, doc.y + 6, { align: 'right' });
          doc.y += rowHeight;

          // Filas de datos
          managerTransactions.forEach((tx) => {
            // Verificar si necesitamos nueva página ANTES de agregar contenido
            if (doc.y + rowHeight > doc.page.height - 60) {
              addFooter();
              doc.addPage();
              addFooter();
              // Re-agregar encabezado de tabla en nueva página
              doc.fontSize(8)
                .fillColor('#ffffff')
                .font('Helvetica-Bold');
              doc.rect(40, doc.y, doc.page.width - 80, rowHeight)
                .fillColor('#34495e')
                .fill();
              doc.text('Fecha', 45, doc.y + 6);
              doc.text('Tipo', 45 + colWidths.fecha, doc.y + 6);
              doc.text('Descripción', 45 + colWidths.fecha + colWidths.tipo, doc.y + 6);
              doc.text('Monto', doc.page.width - 45 - colWidths.monto, doc.y + 6, { align: 'right' });
              doc.y += rowHeight;
            }

            const fecha = DateTime.fromJSDate(tx.createdAt)
              .setZone('America/Argentina/Buenos_Aires')
              .toFormat('dd/MM/yyyy HH:mm');
            const amount = Number(tx.amount);
            const isNegative = amount < 0;
            const translatedType = this.translateTransactionType(tx.type);

            // Construir descripción mejorada
            let description = tx.description || '-';
            if (tx.subLoan?.loan) {
              const clientName = tx.subLoan.loan.client?.fullName || '';
              if (clientName && !description.includes(clientName)) {
                description = `${clientName} - ${description}`;
              }
            }

            doc.fontSize(8)
              .fillColor(isNegative ? '#e74c3c' : '#27ae60')
              .font('Helvetica');
            
            doc.text(fecha, 45, doc.y + 4);
            doc.text(translatedType, 45 + colWidths.fecha, doc.y + 4, {
              width: colWidths.tipo,
              ellipsis: true,
            });
            doc.text(description, 45 + colWidths.fecha + colWidths.tipo, doc.y + 4, {
              width: colWidths.descripcion,
              ellipsis: true,
            });
            doc.text(
              `$${Math.abs(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
              doc.page.width - 45 - colWidths.monto,
              doc.y + 4,
              { align: 'right' }
            );

            // Línea separadora
            doc.moveTo(40, doc.y + rowHeight - 2)
              .lineTo(doc.page.width - 40, doc.y + rowHeight - 2)
              .strokeColor('#ecf0f1')
              .lineWidth(0.5)
              .stroke();

            doc.y += rowHeight;
          });

          doc.moveDown(0.5);

          // Sección de Movimientos de Caja Fuerte del Manager
          if (managerSafeTransactions.length > 0) {
            doc.moveDown(0.3);
            doc.fontSize(12)
              .fillColor('#1a1a1a')
              .font('Helvetica-Bold')
              .text('Movimientos de Caja Fuerte', { underline: false });
            doc.moveDown(0.3);
            // Línea decorativa
            doc.moveTo(40, doc.y)
              .lineTo(doc.page.width - 40, doc.y)
              .strokeColor('#cccccc')
              .lineWidth(1)
              .stroke();
            doc.moveDown(0.5);

            // Tabla de transacciones de safe
            const safeRowHeight = 25;
            const safeColWidths = {
              fecha: 80,
              tipo: 120,
              descripcion: 200,
              monto: 100,
            };

            // Encabezado de tabla
            doc.fontSize(8)
              .fillColor('#ffffff')
              .font('Helvetica-Bold');
            doc.rect(40, doc.y, doc.page.width - 80, safeRowHeight)
              .fillColor('#34495e')
              .fill();
            doc.text('Fecha', 45, doc.y + 8);
            doc.text('Tipo', 45 + safeColWidths.fecha, doc.y + 8);
            doc.text('Descripción', 45 + safeColWidths.fecha + safeColWidths.tipo, doc.y + 8);
            doc.text('Monto', doc.page.width - 45 - safeColWidths.monto, doc.y + 8, { align: 'right' });
            doc.y += safeRowHeight;

            // Filas de transacciones de safe
            managerSafeTransactions.forEach((tx) => {
              if (doc.y + safeRowHeight > doc.page.height - 60) {
                addFooter();
                doc.addPage();
                addFooter();
                // Re-agregar encabezado
                doc.fontSize(8)
                  .fillColor('#ffffff')
                  .font('Helvetica-Bold');
                doc.rect(40, doc.y, doc.page.width - 80, safeRowHeight)
                  .fillColor('#34495e')
                  .fill();
                doc.text('Fecha', 45, doc.y + 8);
                doc.text('Tipo', 45 + safeColWidths.fecha, doc.y + 8);
                doc.text('Descripción', 45 + safeColWidths.fecha + safeColWidths.tipo, doc.y + 8);
                doc.text('Monto', doc.page.width - 45 - safeColWidths.monto, doc.y + 8, { align: 'right' });
                doc.y += safeRowHeight;
              }

              const fecha = DateTime.fromJSDate(tx.createdAt)
                .setZone('America/Argentina/Buenos_Aires')
                .toFormat('dd/MM/yyyy HH:mm');
              const amount = Number(tx.amount);
              const isNegative = amount < 0;
              const translatedType = this.translateTransactionType(tx.type);

              // Construir descripción mejorada
              let description = tx.description || '-';
              if (tx.expense?.name) {
                description = `${description} (${tx.expense.name})`;
              }

              doc.fontSize(8)
                .fillColor(isNegative ? '#e74c3c' : '#27ae60')
                .font('Helvetica');
              
              doc.text(fecha, 45, doc.y + 6);
              doc.text(translatedType, 45 + safeColWidths.fecha, doc.y + 6, {
                width: safeColWidths.tipo,
                ellipsis: true,
              });
              doc.text(description, 45 + safeColWidths.fecha + safeColWidths.tipo, doc.y + 6, {
                width: safeColWidths.descripcion,
                ellipsis: true,
              });
              doc.text(
                `$${Math.abs(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
                doc.page.width - 45 - safeColWidths.monto,
                doc.y + 6,
                { align: 'right' }
              );

              // Línea separadora
              doc.moveTo(40, doc.y + safeRowHeight - 2)
                .lineTo(doc.page.width - 40, doc.y + safeRowHeight - 2)
                .strokeColor('#ecf0f1')
                .lineWidth(0.5)
                .stroke();

              doc.y += safeRowHeight;
            });

            doc.moveDown(0.5);
          }
        });

        // Agregar footer en la última página
        addFooter();
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

