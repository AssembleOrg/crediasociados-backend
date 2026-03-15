import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import {
  PaymentFrequency,
  PaymentDay,
  Prisma,
  SubLoanStatus,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { DateUtil } from '../common/utils';

@Injectable()
export class SubLoanGeneratorService {
  constructor(private prisma: PrismaService) {}

  /**
   * Genera SubLoans automáticamente basado en la configuración del Loan
   */
  async generateSubLoans(
    loanId: string,
    loanData: CreateLoanDto,
    firstDueDate?: Date,
    prismaTransaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const { totalPayments, paymentFrequency, paymentDay, amount, baseInterestRate } = loanData;

    // Use transaction instance if provided, otherwise use the service's prisma instance
    const prismaClient = prismaTransaction || this.prisma;

    // Debug: log the loanId to ensure it's valid
    console.log('GenerateSubLoans - LoanId:', loanId, 'Type:', typeof loanId);

    // Verificar que el loan existe antes de crear los subloans
    const existingLoan = await prismaClient.loan.findUnique({
      where: { id: loanId },
      select: { id: true },
    });

    if (!existingLoan) {
      console.error('Loan not found with id:', loanId);
      throw new Error(`Loan with id ${loanId} not found`);
    }

    console.log('Loan found:', existingLoan.id);

    // Calcular monto por SubLoan (solo capital)
    const amountPerSubLoan = Number(amount) / totalPayments;

    // Calcular interés total del préstamo
    const totalInterest = Number(amount) * Number(baseInterestRate);
    
    // Calcular interés por cuota
    const interestPerSubLoan = totalInterest / totalPayments;
    
    // Total por cuota = capital + interés
    const totalAmountPerSubLoan = amountPerSubLoan + interestPerSubLoan;

    // Calcular fechas de vencimiento
    const dueDates = this.calculateDueDates(
      totalPayments,
      paymentFrequency,
      paymentDay,
      firstDueDate,
    );

    // Crear SubLoans
    const subLoansData = dueDates.map((dueDate, index) => ({
      loanId,
      paymentNumber: index + 1,
      amount: new Prisma.Decimal(amountPerSubLoan.toFixed(2)),
      totalAmount: new Prisma.Decimal(totalAmountPerSubLoan.toFixed(2)),
      status: SubLoanStatus.PENDING,
      dueDate,
      paidAmount: new Prisma.Decimal(0),
      daysOverdue: 0,
    }));

    // Debug: log subloan data before creation
    console.log('Creating subloans for loan:', loanId);
    console.log('Number of subloans to create:', subLoansData.length);
    console.log('First subloan data:', subLoansData[0]);
    console.log('Interest calculation:', {
      loanAmount: amount,
      baseInterestRate,
      totalInterest,
      interestPerSubLoan,
      amountPerSubLoan,
      totalAmountPerSubLoan,
    });

    // Crear todos los SubLoans en una sola operación
    await prismaClient.subLoan.createMany({
      data: subLoansData,
    });

    console.log('SubLoans created successfully for loan:', loanId);
  }

  /**
   * Calcula las fechas de vencimiento para todos los SubLoans
   * Usa Luxon en zona horaria Argentina para evitar desfases UTC.
   */
  private calculateDueDates(
    totalPayments: number,
    paymentFrequency: PaymentFrequency,
    paymentDay?: PaymentDay,
    firstDueDate?: Date,
  ): Date[] {
    const tz = DateUtil.BUENOS_AIRES_TIMEZONE;
    const dueDates: DateTime[] = [];

    // Determinar la fecha inicial en zona Argentina
    let start: DateTime;

    if (firstDueDate) {
      start = DateTime.fromJSDate(firstDueDate).setZone(tz).startOf('day');
    } else {
      // Día siguiente a hoy en Argentina
      start = DateUtil.now().plus({ days: 1 }).startOf('day');

      // Para frecuencias no diarias, respetar el paymentDay
      if (paymentFrequency !== 'DAILY' && paymentDay) {
        const targetDay = this.getDayOfWeekNumber(paymentDay);
        const currentDay = start.weekday; // Luxon: 1=Lun … 7=Dom
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd < 0) daysToAdd += 7;
        start = start.plus({ days: daysToAdd });

        // Si el día ya pasó esta semana, mover a la próxima
        const today = DateUtil.now().startOf('day');
        if (start <= today) {
          start = start.plus({ days: 7 });
        }
      }
    }

    // Ajustar si cae en domingo
    start = this.adjustSunday(start);

    for (let i = 0; i < totalPayments; i++) {
      let dueDate: DateTime;

      switch (paymentFrequency) {
        case 'DAILY':
          dueDate = start.plus({ days: i });
          dueDate = this.adjustSunday(dueDate);
          break;

        case 'WEEKLY':
          dueDate = start.plus({ weeks: i });
          dueDate = this.adjustSunday(dueDate);
          break;

        case 'BIWEEKLY':
          dueDate = start.plus({ weeks: i * 2 });
          dueDate = this.adjustSunday(dueDate);
          break;

        case 'MONTHLY':
          dueDate = start.plus({ months: i });
          // Si el día no existe en el mes, Luxon ya ajusta al último día válido
          dueDate = this.adjustSunday(dueDate);
          break;

        default:
          dueDate = start.plus({ days: i });
          break;
      }

      // Para DAILY, asegurar que no haya fechas duplicadas (por ajuste de domingo)
      if (paymentFrequency === 'DAILY') {
        dueDate = this.ensureUniqueDateLuxon(dueDate, dueDates);
      }

      dueDates.push(dueDate);
    }

    // Convertir a JS Date al mediodía Argentina para evitar desfases UTC
    return dueDates.map((dt) => dt.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate());
  }

  /**
   * Convierte PaymentDay enum a número de día Luxon (1=Lunes … 6=Sábado)
   */
  private getDayOfWeekNumber(paymentDay: PaymentDay): number {
    const dayMap = {
      [PaymentDay.MONDAY]: 1,
      [PaymentDay.TUESDAY]: 2,
      [PaymentDay.WEDNESDAY]: 3,
      [PaymentDay.THURSDAY]: 4,
      [PaymentDay.FRIDAY]: 5,
      [PaymentDay.SATURDAY]: 6,
    };

    return dayMap[paymentDay];
  }

  /**
   * Ajusta una fecha que cae en domingo (weekday 7) al lunes siguiente
   */
  private adjustSunday(dt: DateTime): DateTime {
    if (dt.weekday === 7) {
      return dt.plus({ days: 1 });
    }
    return dt;
  }

  /**
   * Asegura que la fecha sea única comparándola con las fechas existentes
   */
  private ensureUniqueDateLuxon(newDate: DateTime, existingDates: DateTime[]): DateTime {
    let adjusted = newDate;

    while (existingDates.some((d) => d.hasSame(adjusted, 'day'))) {
      adjusted = adjusted.plus({ days: 1 });
      adjusted = this.adjustSunday(adjusted);
    }

    return adjusted;
  }
}
