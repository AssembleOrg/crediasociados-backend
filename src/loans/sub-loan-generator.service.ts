import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { PaymentFrequency, PaymentDay } from '@prisma/client';

@Injectable()
export class SubLoanGeneratorService {
  constructor(private prisma: PrismaService) {}

  /**
   * Genera SubLoans automáticamente basado en la configuración del Loan
   */
  async generateSubLoans(loanId: string, loanData: CreateLoanDto, firstDueDate?: Date): Promise<void> {
    const { totalPayments, paymentFrequency, paymentDay, amount } = loanData;
    
    // Calcular monto por SubLoan
    const amountPerSubLoan = Number(amount) / totalPayments;
    
    // Calcular fechas de vencimiento
    const dueDates = this.calculateDueDates(totalPayments, paymentFrequency, paymentDay, firstDueDate);
    
    // Crear SubLoans
    const subLoansData = dueDates.map((dueDate, index) => ({
      loanId,
      paymentNumber: index + 1,
      amount: amountPerSubLoan,
      totalAmount: amountPerSubLoan, // Sin interés individual
      status: 'PENDING' as const,
      dueDate,
      paidAmount: 0,
      daysOverdue: 0,
    }));

    // Crear todos los SubLoans en una sola operación
    await this.prisma.subLoan.createMany({
      data: subLoansData,
    });
  }

  /**
   * Calcula las fechas de vencimiento para todos los SubLoans
   */
  private calculateDueDates(
    totalPayments: number,
    paymentFrequency: PaymentFrequency,
    paymentDay?: PaymentDay,
    firstDueDate?: Date
  ): Date[] {
    const dueDates: Date[] = [];
    let currentDate = firstDueDate || new Date();
    
    // Si no hay fecha específica, usar la fecha actual
    if (!firstDueDate) {
      currentDate = new Date();
    }

    for (let i = 0; i < totalPayments; i++) {
      const dueDate = new Date(currentDate);
      
      // Ajustar la fecha según la frecuencia de pago
      switch (paymentFrequency) {
        case 'DAILY':
          dueDate.setDate(dueDate.getDate() + i);
          break;
          
        case 'WEEKLY':
          dueDate.setDate(dueDate.getDate() + (i * 7));
          break;
          
        case 'BIWEEKLY':
          dueDate.setDate(dueDate.getDate() + (i * 14));
          break;
          
        case 'MONTHLY':
          dueDate.setMonth(dueDate.getMonth() + i);
          break;
      }
      
      // Si hay un día específico de pago, ajustar la fecha
      if (paymentDay) {
        dueDate.setDate(this.getDayOfWeek(paymentDay));
      }
      
      dueDates.push(dueDate);
    }
    
    return dueDates;
  }

  /**
   * Convierte PaymentDay enum a número de día de la semana (1-7)
   */
  private getDayOfWeek(paymentDay: PaymentDay): number {
    const dayMap = {
      'MONDAY': 1,
      'TUESDAY': 2,
      'WEDNESDAY': 3,
      'THURSDAY': 4,
      'FRIDAY': 5,
      'SATURDAY': 6,
      'SUNDAY': 0,
    };
    
    return dayMap[paymentDay];
  }
} 