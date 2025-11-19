import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CollectorWalletService } from '../collector-wallet/collector-wallet.service';
import { RegisterPaymentDto, BulkPaymentDto } from './dto';
import { Prisma, SubLoanStatus, UserRole } from '@prisma/client';
import { DateUtil } from '../common/utils';
import { WalletTransactionType } from '../common/enums';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private collectorWalletService: CollectorWalletService,
  ) {}

  /**
   * Registrar un pago para un SubLoan con lógica de distribución de excedentes
   */
  async registerPayment(
    userId: string,
    userRole: UserRole,
    registerPaymentDto: RegisterPaymentDto,
  ): Promise<any> {
    const { subLoanId, amount, currency, paymentDate, description } =
      registerPaymentDto;

    // Obtener el SubLoan con su Loan y Client
    const subLoan = await this.prisma.subLoan.findUnique({
      where: { id: subLoanId },
      include: {
        loan: {
          include: {
            client: {
              include: {
                managers: {
                  where: { deletedAt: null },
                },
              },
            },
          },
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    if (subLoan.deletedAt) {
      throw new BadRequestException('SubLoan eliminado');
    }

    // Validar que el usuario tenga acceso

    console.table({ userRole, userId });
    if (userRole === UserRole.MANAGER) {
      const hasAccess = subLoan.loan.client.managers.some(
        (m) => m.userId === userId,
      );
      if (!hasAccess) {
        throw new ForbiddenException('No tienes acceso a este SubLoan');
      }
    }

    // Validar que no esté ya pagado completamente
    if (subLoan.status === SubLoanStatus.PAID) {
      throw new BadRequestException(
        'Este SubLoan ya está completamente pagado',
      );
    }

    // Validar moneda
    if (subLoan.loan.currency !== currency) {
      throw new BadRequestException(
        `El préstamo usa ${subLoan.loan.currency}, no se puede pagar en ${currency}`,
      );
    }

    const managerId = subLoan.loan.managerId;
    if (!managerId) {
      throw new BadRequestException('El préstamo no tiene manager asignado');
    }

    // Realizar el pago y distribución en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      let remainingAmount = amount;
      const distributedPayments: any[] = [];

      // 1. Procesar el pago del SubLoan actual
      const currentRemainingAmount =
        Number(subLoan.totalAmount) - Number(subLoan.paidAmount);

      let updatedSubLoan: any;

      if (remainingAmount >= currentRemainingAmount) {
        // Pago completa o excede la cuota actual
        updatedSubLoan = await tx.subLoan.update({
          where: { id: subLoanId },
          data: {
            paidAmount: subLoan.totalAmount,
            status: SubLoanStatus.PAID,
            paidDate: paymentDate
              ? DateUtil.parseToDate(paymentDate)
              : DateUtil.now().toJSDate(),
            paymentHistory: this.addToPaymentHistory(
              subLoan.paymentHistory,
              currentRemainingAmount,
              0,
              paymentDate,
            ),
          },
        });

        remainingAmount -= currentRemainingAmount;

        distributedPayments.push({
          subLoanId: subLoan.id,
          paymentNumber: subLoan.paymentNumber,
          distributedAmount: currentRemainingAmount,
          newStatus: SubLoanStatus.PAID,
          newPaidAmount: Number(subLoan.totalAmount),
        });
      } else {
        // Pago parcial
        const newPaidAmount = Number(subLoan.paidAmount) + remainingAmount;
        const newRemainingAmount = Number(subLoan.totalAmount) - newPaidAmount;

        updatedSubLoan = await tx.subLoan.update({
          where: { id: subLoanId },
          data: {
            paidAmount: new Prisma.Decimal(newPaidAmount),
            status: SubLoanStatus.PARTIAL,
            paymentHistory: this.addToPaymentHistory(
              subLoan.paymentHistory,
              remainingAmount,
              newRemainingAmount,
              paymentDate,
            ),
          },
        });

        distributedPayments.push({
          subLoanId: subLoan.id,
          paymentNumber: subLoan.paymentNumber,
          distributedAmount: remainingAmount,
          newStatus: SubLoanStatus.PARTIAL,
          newPaidAmount,
        });

        remainingAmount = 0;
      }

      // 2. Si hay excedente, buscar SubLoans anteriores PARTIAL
      if (remainingAmount > 0) {
        const partialSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { lt: subLoan.paymentNumber },
            status: SubLoanStatus.PARTIAL,
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'asc' },
        });

        for (const partial of partialSubLoans) {
          if (remainingAmount <= 0) break;

          const partialRemainingAmount =
            Number(partial.totalAmount) - Number(partial.paidAmount);

          if (remainingAmount >= partialRemainingAmount) {
            // Completar este SubLoan
            await tx.subLoan.update({
              where: { id: partial.id },
              data: {
                paidAmount: partial.totalAmount,
                status: SubLoanStatus.PAID,
                paidDate: paymentDate
                  ? DateUtil.parseToDate(paymentDate)
                  : DateUtil.now().toJSDate(),
                paymentHistory: this.addToPaymentHistory(
                  partial.paymentHistory,
                  partialRemainingAmount,
                  0,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: partial.id,
              paymentNumber: partial.paymentNumber,
              distributedAmount: partialRemainingAmount,
              newStatus: SubLoanStatus.PAID,
              newPaidAmount: Number(partial.totalAmount),
            });

            remainingAmount -= partialRemainingAmount;
          } else {
            // Pago parcial a este SubLoan
            const newPaidAmount = Number(partial.paidAmount) + remainingAmount;
            const newRemainingAmount =
              Number(partial.totalAmount) - newPaidAmount;

            await tx.subLoan.update({
              where: { id: partial.id },
              data: {
                paidAmount: new Prisma.Decimal(newPaidAmount),
                status: SubLoanStatus.PARTIAL,
                paymentHistory: this.addToPaymentHistory(
                  partial.paymentHistory,
                  remainingAmount,
                  newRemainingAmount,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: partial.id,
              paymentNumber: partial.paymentNumber,
              distributedAmount: remainingAmount,
              newStatus: SubLoanStatus.PARTIAL,
              newPaidAmount,
            });

            remainingAmount = 0;
          }
        }
      }

      // 3. Crear registro de pago
      const payment = await tx.payment.create({
        data: {
          subLoanId,
          amount: new Prisma.Decimal(amount),
          currency,
          paymentDate: paymentDate
            ? DateUtil.parseToDate(paymentDate)
            : DateUtil.now().toJSDate(),
          description: description || `Pago SubLoan #${subLoan.paymentNumber}`,
        },
      });

      // 4. Acreditar a la cartera del manager
      await this.walletService.credit({
        userId: managerId,
        amount,
        type: WalletTransactionType.LOAN_PAYMENT,
        description: `Pago préstamo ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
        transaction: tx,
      });

      // 5. Registrar el cobro en la wallet del cobrador del manager asignado al cliente
      // Siempre actualizar la wallet del manager, independientemente de quién registre el pago
      await this.collectorWalletService.recordCollection({
        userId: managerId, // Usar el manager del cliente, no quien registra el pago
        amount,
        description: `Cobro préstamo ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
        subLoanId,
        transaction: tx,
      });

      return {
        payment,
        subLoan: updatedSubLoan,
        distributedPayments,
      };
    });

    return {
      payment: {
        ...result.payment,
        amount: Number(result.payment.amount),
      },
      subLoan: {
        id: result.subLoan.id,
        paymentNumber: result.subLoan.paymentNumber,
        status: result.subLoan.status,
        paidAmount: Number(result.subLoan.paidAmount),
        totalAmount: Number(result.subLoan.totalAmount),
        remainingAmount:
          Number(result.subLoan.totalAmount) -
          Number(result.subLoan.paidAmount),
      },
      distributedPayments: result.distributedPayments,
    };
  }

  /**
   * Registrar múltiples pagos
   */
  async registerBulkPayments(
    userId: string,
    userRole: UserRole,
    bulkPaymentDto: BulkPaymentDto,
  ): Promise<any> {
    const results: any[] = [];

    for (const paymentDto of bulkPaymentDto.payments) {
      try {
        const result = await this.registerPayment(userId, userRole, paymentDto);
        results.push({
          success: true,
          subLoanId: paymentDto.subLoanId,
          result,
        });
      } catch (error: any) {
        results.push({
          success: false,
          subLoanId: paymentDto.subLoanId,
          error: error.message,
        });
      }
    }

    return {
      total: bulkPaymentDto.payments.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Obtener historial de pagos de un SubLoan
   */
  async getSubLoanPayments(
    subLoanId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<any> {
    const subLoan = await this.prisma.subLoan.findUnique({
      where: { id: subLoanId },
      include: {
        payments: {
          orderBy: { paymentDate: 'asc' },
        },
        loan: {
          include: {
            client: {
              include: {
                managers: {
                  where: { deletedAt: null },
                },
              },
            },
          },
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    // Validar acceso
    if (userRole === UserRole.MANAGER) {
      const hasAccess = subLoan.loan.client.managers.some(
        (m) => m.userId === userId,
      );
      if (!hasAccess) {
        throw new ForbiddenException('No tienes acceso a este SubLoan');
      }
    }

    return {
      subLoan: {
        id: subLoan.id,
        paymentNumber: subLoan.paymentNumber,
        amount: Number(subLoan.amount),
        totalAmount: Number(subLoan.totalAmount),
        paidAmount: Number(subLoan.paidAmount),
        status: subLoan.status,
        dueDate: subLoan.dueDate,
        paidDate: subLoan.paidDate,
      },
      payments: subLoan.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        currency: p.currency,
        paymentDate: p.paymentDate,
        description: p.description,
        createdAt: p.createdAt,
      })),
      paymentHistory: subLoan.paymentHistory || [],
    };
  }

  /**
   * Helper: Agregar entrada al historial de pagos
   */
  private addToPaymentHistory(
    currentHistory: any,
    amount: number,
    balance: number,
    paymentDate?: string,
  ): any {
    const history = Array.isArray(currentHistory) ? currentHistory : [];

    return [
      ...history,
      {
        date: paymentDate
          ? DateUtil.parseToDate(paymentDate).toISOString()
          : DateUtil.now().toISO(),
        amount,
        balance,
      },
    ];
  }
}
