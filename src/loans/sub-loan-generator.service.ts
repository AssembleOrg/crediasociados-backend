import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import {
  PaymentFrequency,
  PaymentDay,
  Prisma,
  SubLoanStatus,
} from '@prisma/client';
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
    const { totalPayments, paymentFrequency, paymentDay, amount } = loanData;

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

    // Calcular monto por SubLoan
    const amountPerSubLoan = Number(amount) / totalPayments;

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
      amount: new Prisma.Decimal(amountPerSubLoan),
      totalAmount: new Prisma.Decimal(amountPerSubLoan),
      status: SubLoanStatus.PENDING,
      dueDate,
      paidAmount: new Prisma.Decimal(0),
      daysOverdue: 0,
    }));

    // Debug: log subloan data before creation
    console.log('Creating subloans for loan:', loanId);
    console.log('Number of subloans to create:', subLoansData.length);
    console.log('First subloan data:', subLoansData[0]);

    // Crear todos los SubLoans en una sola operación
    await prismaClient.subLoan.createMany({
      data: subLoansData,
    });

    console.log('SubLoans created successfully for loan:', loanId);
  }

  /**
   * Calcula las fechas de vencimiento para todos los SubLoans
   */
  private calculateDueDates(
    totalPayments: number,
    paymentFrequency: PaymentFrequency,
    paymentDay?: PaymentDay,
    firstDueDate?: Date,
  ): Date[] {
    const dueDates: Date[] = [];
    let currentDate = firstDueDate || DateUtil.now().toJSDate();

    // Si no hay fecha específica, usar la fecha actual
    if (!firstDueDate) {
      currentDate = DateUtil.now().toJSDate();
    }

    for (let i = 0; i < totalPayments; i++) {
      let dueDate = DateUtil.fromJSDate(currentDate).toJSDate();

      // Ajustar la fecha según la frecuencia de pago
      switch (paymentFrequency) {
        case 'DAILY':
          dueDate.setDate(dueDate.getDate() + i);
          break;

        case 'WEEKLY':
          dueDate.setDate(dueDate.getDate() + i * 7);
          break;

        case 'BIWEEKLY':
          dueDate.setDate(dueDate.getDate() + i * 14);
          break;

        case 'MONTHLY':
          dueDate.setMonth(dueDate.getMonth() + i);
          break;
      }

      // Verificar si la fecha cae en domingo y ajustarla al lunes siguiente
      dueDate = this.adjustSundayToMonday(dueDate);

      // Verificar que no haya fechas duplicadas
      dueDate = this.ensureUniqueDate(dueDate, dueDates);

      dueDates.push(dueDate);
    }

    return dueDates;
  }

  /**
   * Ajusta la fecha al día específico de la semana
   */
  private setToDayOfWeek(date: Date, paymentDay: PaymentDay): void {
    const targetDay = this.getDayOfWeekNumber(paymentDay);
    const currentDay = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Convert to our system where 1 = Monday, 2 = Tuesday, ..., 6 = Saturday, 0 = Sunday
    const currentDayAdjusted = currentDay === 0 ? 7 : currentDay;

    // Calculate the difference and adjust
    let daysToAdd = targetDay - currentDayAdjusted;
    if (daysToAdd < 0) {
      daysToAdd += 7; // Move to next week
    }

    date.setDate(date.getDate() + daysToAdd);
  }

  /**
   * Convierte PaymentDay enum a número de día de la semana (1-7, where 1=Monday, 7=Sunday)
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
   * Ajusta una fecha que cae en domingo al lunes siguiente
   */
  private adjustSundayToMonday(date: Date): Date {
    const adjustedDate = new Date(date);

    // Si la fecha cae en domingo (day = 0), moverla al lunes siguiente
    if (adjustedDate.getDay() === 0) {
      adjustedDate.setDate(adjustedDate.getDate() + 1);
    }

    return adjustedDate;
  }

  /**
   * Asegura que la fecha sea única comparándola con las fechas existentes
   */
  private ensureUniqueDate(newDate: Date, existingDates: Date[]): Date {
    let adjustedDate = new Date(newDate);

    // Verificar si la fecha ya existe
    while (this.isDateInArray(adjustedDate, existingDates)) {
      // Si la fecha ya existe, moverla al día siguiente
      adjustedDate.setDate(adjustedDate.getDate() + 1);

      // Verificar nuevamente si el nuevo día es domingo y ajustarlo
      adjustedDate = this.adjustSundayToMonday(adjustedDate);
    }

    return adjustedDate;
  }

  /**
   * Verifica si una fecha ya existe en el array de fechas
   */
  private isDateInArray(date: Date, dateArray: Date[]): boolean {
    const dateString = date.toDateString();
    return dateArray.some(
      (existingDate) => existingDate.toDateString() === dateString,
    );
  }
}
