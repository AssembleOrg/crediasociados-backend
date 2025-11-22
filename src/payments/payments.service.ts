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
import { WalletTransactionType, CollectorWalletTransactionType } from '../common/enums';

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

    // Verificar si está pagado y si podemos modificar el pago del mismo día
    let shouldRevertLastPayment = false;
    let lastPayment: any = null;
    let lastPaymentAmount = 0;

    if (subLoan.status === SubLoanStatus.PAID) {
      // Obtener el último pago del subpréstamo
      const payments = await this.prisma.payment.findMany({
        where: { subLoanId },
        orderBy: { paymentDate: 'desc' },
        take: 1,
      });

      if (payments.length > 0) {
        lastPayment = payments[0];
        lastPaymentAmount = Number(lastPayment.amount);

        // Verificar si el último pago fue hoy
        const lastPaymentDate = DateUtil.fromPrismaDate(lastPayment.paymentDate);
        const today = DateUtil.now();
        const paymentDateToUse = paymentDate
          ? DateUtil.fromISO(paymentDate)
          : today;

        // Comparar solo la fecha (sin hora)
        const isSameDay =
          lastPaymentDate.toFormat('yyyy-MM-dd') ===
          paymentDateToUse.toFormat('yyyy-MM-dd');

        if (isSameDay) {
          shouldRevertLastPayment = true;
        } else {
          throw new BadRequestException(
            'Este SubLoan ya está completamente pagado y el último pago no fue hoy',
          );
        }
      } else {
        throw new BadRequestException(
          'Este SubLoan está marcado como pagado pero no tiene pagos registrados',
        );
      }
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
    // Timeout aumentado a 30 segundos para transacciones complejas
    const result = await this.prisma.$transaction(async (tx) => {
      // 0. Si necesitamos revertir el último pago, hacerlo primero
      if (shouldRevertLastPayment && lastPayment) {
        // Revertir el crédito en la wallet del manager
        await this.walletService.debit({
          userId: managerId,
          amount: lastPaymentAmount,
          type: WalletTransactionType.LOAN_PAYMENT,
          description: `Reversión pago préstamo ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
          transaction: tx,
        });

        // Revertir el registro en collector wallet
        const collectorWallet = await this.collectorWalletService.getOrCreateWallet(
          managerId,
          tx,
        );
        const collectorBalanceBefore = Number(collectorWallet.balance);
        const collectorBalanceAfter = collectorBalanceBefore - lastPaymentAmount;

        await tx.collectorWallet.update({
          where: { id: collectorWallet.id },
          data: {
            balance: {
              decrement: new Prisma.Decimal(lastPaymentAmount),
            },
          },
        });

        // Crear transacción de reversión en collector wallet
        await tx.collectorWalletTransaction.create({
          data: {
            walletId: collectorWallet.id,
            userId: managerId,
            type: CollectorWalletTransactionType.COLLECTION,
            amount: new Prisma.Decimal(-lastPaymentAmount), // Negativo para indicar reversión
            currency: collectorWallet.currency,
            description: `Reversión cobro préstamo ${subLoan.loan.client.fullName} - Cuota #${subLoan.paymentNumber}`,
            balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
            balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
            subLoanId,
          },
        });

        // Calcular cuánto se aplicó realmente a este subpréstamo
        // Si el subpréstamo estaba parcialmente pagado antes del último pago,
        // el monto aplicado a este subpréstamo es: min(lastPaymentAmount, remainingAmount del subpréstamo en ese momento)
        // Pero como no tenemos el estado anterior, usamos el paymentHistory para estimar
        const paymentHistory = Array.isArray(subLoan.paymentHistory)
          ? subLoan.paymentHistory
          : [];
        const lastHistoryEntry = paymentHistory[paymentHistory.length - 1] as any;
        const amountAppliedToThisSubLoan =
          lastHistoryEntry && typeof lastHistoryEntry === 'object' && 'amount' in lastHistoryEntry
            ? Number(lastHistoryEntry.amount)
            : Math.min(
                lastPaymentAmount,
                Number(subLoan.totalAmount) -
                  (Number(subLoan.paidAmount) - lastPaymentAmount),
              );

        // Buscar otros subpréstamos del mismo préstamo que puedan haber recibido parte del excedente
        // (solo si el pago excedió el monto necesario para este subpréstamo)
        const excessAmount = lastPaymentAmount - amountAppliedToThisSubLoan;
        
        if (excessAmount > 0) {
          // Buscar subpréstamos parciales anteriores que puedan haber recibido el excedente
          const partialSubLoans = await tx.subLoan.findMany({
            where: {
              loanId: subLoan.loanId,
              paymentNumber: { lt: subLoan.paymentNumber },
              status: SubLoanStatus.PARTIAL,
              deletedAt: null,
            },
            orderBy: { paymentNumber: 'desc' }, // Empezar por el más reciente
          });

          // Revertir el excedente de los subpréstamos parciales (en orden inverso)
          // OPTIMIZACIÓN: Obtener todos los pagos de una vez en lugar de hacer queries individuales
          const partialSubLoanIds = partialSubLoans.map(p => p.id);
          const paymentDateStart = DateUtil.startOfDay(
            DateUtil.fromPrismaDate(lastPayment.paymentDate),
          ).toJSDate();
          const paymentDateEnd = DateUtil.endOfDay(
            DateUtil.fromPrismaDate(lastPayment.paymentDate),
          ).toJSDate();

          // Obtener todos los pagos de los subloans parciales del mismo día en una sola query
          const allPartialPayments = partialSubLoanIds.length > 0
            ? await tx.payment.findMany({
                where: {
                  subLoanId: { in: partialSubLoanIds },
                  paymentDate: {
                    gte: paymentDateStart,
                    lte: paymentDateEnd,
                  },
                },
                orderBy: [
                  { subLoanId: 'asc' },
                  { paymentDate: 'desc' },
                ],
              })
            : [];

          // Agrupar pagos por subLoanId y tomar el más reciente de cada uno
          const paymentsBySubLoan = new Map<string, any>();
          for (const payment of allPartialPayments) {
            if (!paymentsBySubLoan.has(payment.subLoanId)) {
              paymentsBySubLoan.set(payment.subLoanId, payment);
            }
          }

          let remainingExcess = excessAmount;
          for (const partial of partialSubLoans) {
            if (remainingExcess <= 0) break;

            const partialPayment = paymentsBySubLoan.get(partial.id);
            if (!partialPayment) continue;

            const partialPaymentAmount = Number(partialPayment.amount);
            const partialAmountToRevert = Math.min(
              remainingExcess,
              partialPaymentAmount,
            );

            // Revertir el efecto en este subpréstamo parcial
            const partialPreviousPaidAmount =
              Number(partial.paidAmount) - partialAmountToRevert;
            
            await tx.subLoan.update({
              where: { id: partial.id },
              data: {
                paidAmount: new Prisma.Decimal(
                  Math.max(0, partialPreviousPaidAmount),
                ),
                status:
                  partialPreviousPaidAmount > 0
                    ? SubLoanStatus.PARTIAL
                    : SubLoanStatus.PENDING,
                paidDate:
                  partialPreviousPaidAmount > 0 ? partial.paidDate : null,
                paymentHistory: this.removeLastPaymentFromHistory(
                  partial.paymentHistory,
                ),
              },
            });

            // Eliminar el pago del subpréstamo parcial si fue completamente revertido
            if (partialAmountToRevert >= partialPaymentAmount) {
              await tx.payment.delete({
                where: { id: partialPayment.id },
              });
            } else {
              // Si solo se revirtió parcialmente, actualizar el monto del pago
              await tx.payment.update({
                where: { id: partialPayment.id },
                data: {
                  amount: new Prisma.Decimal(
                    partialPaymentAmount - partialAmountToRevert,
                  ),
                },
              });
            }

            remainingExcess -= partialAmountToRevert;
          }
        }

        // Eliminar el último pago del subpréstamo actual
        await tx.payment.delete({
          where: { id: lastPayment.id },
        });

        // Actualizar el SubLoan actual: resetear paidAmount y status
        const previousPaidAmount =
          Number(subLoan.paidAmount) - amountAppliedToThisSubLoan;
        await tx.subLoan.update({
          where: { id: subLoanId },
          data: {
            paidAmount: new Prisma.Decimal(Math.max(0, previousPaidAmount)),
            status:
              previousPaidAmount > 0
                ? SubLoanStatus.PARTIAL
                : SubLoanStatus.PENDING,
            paidDate: previousPaidAmount > 0 ? subLoan.paidDate : null,
            // Remover la última entrada del historial de pagos
            paymentHistory: this.removeLastPaymentFromHistory(
              subLoan.paymentHistory,
            ),
          },
        });

        // Actualizar subLoan para reflejar el estado revertido
        subLoan.paidAmount = new Prisma.Decimal(Math.max(0, previousPaidAmount));
        subLoan.status =
          previousPaidAmount > 0
            ? SubLoanStatus.PARTIAL
            : SubLoanStatus.PENDING;
      }

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
        description: `Cobro préstamo ${subLoan.loan.client.fullName} - Cuota #${subLoan.paymentNumber}`,
        subLoanId,
        transaction: tx,
      });

      return {
        payment,
        subLoan: updatedSubLoan,
        distributedPayments,
      };
    }, {
      maxWait: 30000, // 30 segundos máximo de espera para iniciar la transacción
      timeout: 30000, // 30 segundos máximo de ejecución de la transacción
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

  /**
   * Helper: Remover la última entrada del historial de pagos
   */
  private removeLastPaymentFromHistory(currentHistory: any): any {
    const history = Array.isArray(currentHistory) ? currentHistory : [];
    if (history.length === 0) {
      return [];
    }
    // Retornar el historial sin la última entrada
    return history.slice(0, -1);
  }

  /**
   * Helper: Agregar entrada de reset al historial de pagos
   */
  private addResetToPaymentHistory(
    currentHistory: any,
    totalAmountReset: number,
  ): any {
    const history = Array.isArray(currentHistory) ? currentHistory : [];

    return [
      ...history,
      {
        date: DateUtil.now().toISO(),
        type: 'RESET',
        amount: -totalAmountReset, // Negativo para indicar que se eliminó
        balance: 0,
        description: 'Reseteo completo de pagos',
      },
    ];
  }

  /**
   * Resetear todos los pagos de un SubLoan
   * Solo se permite si el último pago fue hace menos de 24 horas
   */
  async resetSubLoanPayments(
    subLoanId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<any> {
    // Obtener el SubLoan con sus pagos
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
        payments: {
          orderBy: { paymentDate: 'desc' },
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    if (subLoan.deletedAt) {
      throw new BadRequestException('SubLoan eliminado');
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

    // Validar que haya pagos
    if (subLoan.payments.length === 0) {
      throw new BadRequestException('El SubLoan no tiene pagos para resetear');
    }

    // Validar que el último pago no sea mayor a 24 horas
    const lastPayment = subLoan.payments[0];
    const lastPaymentDate = DateUtil.fromPrismaDate(lastPayment.paymentDate);
    const now = DateUtil.now();
    const hoursDiff = now.diff(lastPaymentDate, 'hours').hours;

    if (hoursDiff > 24) {
      throw new BadRequestException(
        `No se puede resetear: el último pago fue hace ${Math.floor(hoursDiff)} horas. Solo se permiten reseteos de pagos realizados en las últimas 24 horas.`,
      );
    }

    const managerId = subLoan.loan.managerId;
    if (!managerId) {
      throw new BadRequestException('El préstamo no tiene manager asignado');
    }

    // Calcular el monto total de todos los pagos
    const totalPaidAmount = subLoan.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Realizar el reset en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Revertir efectos en wallets
      // Revertir crédito en wallet del manager
      await this.walletService.debit({
        userId: managerId,
        amount: totalPaidAmount,
        type: WalletTransactionType.LOAN_PAYMENT,
        description: `Reseteo pagos SubLoan ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
        transaction: tx,
      });

      // Revertir registro en collector wallet
      const collectorWallet = await this.collectorWalletService.getOrCreateWallet(
        managerId,
        tx,
      );
      const collectorBalanceBefore = Number(collectorWallet.balance);
      const collectorBalanceAfter = collectorBalanceBefore - totalPaidAmount;

      await tx.collectorWallet.update({
        where: { id: collectorWallet.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(totalPaidAmount),
          },
        },
      });

      // Crear transacción de reversión en collector wallet
      await tx.collectorWalletTransaction.create({
        data: {
          walletId: collectorWallet.id,
          userId: managerId,
          type: CollectorWalletTransactionType.PAYMENT_RESET,
          amount: new Prisma.Decimal(-totalPaidAmount),
          currency: collectorWallet.currency,
          description: `Reseteo cobros ${subLoan.loan.client.fullName} - Cuota #${subLoan.paymentNumber}`,
          balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
          balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
          subLoanId,
        },
      });

      // 2. Buscar y revertir excedentes en subloans parciales anteriores
      const currentSubLoanTotalAmount = Number(subLoan.totalAmount);
      const excessAmount = totalPaidAmount - currentSubLoanTotalAmount;

      if (excessAmount > 0) {
        // Buscar subpréstamos parciales anteriores que recibieron el excedente
        const partialSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { lt: subLoan.paymentNumber },
            status: SubLoanStatus.PARTIAL,
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'desc' },
        });

        // Obtener todos los pagos de los subloans parciales en batch
        const partialSubLoanIds = partialSubLoans.map((p) => p.id);
        const allPartialPayments =
          partialSubLoanIds.length > 0
            ? await tx.payment.findMany({
                where: {
                  subLoanId: { in: partialSubLoanIds },
                },
                orderBy: [
                  { subLoanId: 'asc' },
                  { paymentDate: 'desc' },
                ],
              })
            : [];

        // Agrupar pagos por subLoanId y tomar el más reciente de cada uno
        const paymentsBySubLoan = new Map<string, any>();
        for (const payment of allPartialPayments) {
          if (!paymentsBySubLoan.has(payment.subLoanId)) {
            paymentsBySubLoan.set(payment.subLoanId, payment);
          }
        }

        // Revertir excedentes de subloans parciales
        let remainingExcess = excessAmount;
        for (const partial of partialSubLoans) {
          if (remainingExcess <= 0) break;

          const partialPayment = paymentsBySubLoan.get(partial.id);
          if (!partialPayment) continue;

          const partialPaymentAmount = Number(partialPayment.amount);
          const partialAmountToRevert = Math.min(
            remainingExcess,
            partialPaymentAmount,
          );

          const partialPreviousPaidAmount =
            Number(partial.paidAmount) - partialAmountToRevert;

          await tx.subLoan.update({
            where: { id: partial.id },
            data: {
              paidAmount: new Prisma.Decimal(
                Math.max(0, partialPreviousPaidAmount),
              ),
              status:
                partialPreviousPaidAmount > 0
                  ? SubLoanStatus.PARTIAL
                  : SubLoanStatus.PENDING,
              paidDate:
                partialPreviousPaidAmount > 0 ? partial.paidDate : null,
              paymentHistory: this.removeLastPaymentFromHistory(
                partial.paymentHistory,
              ),
            },
          });

          // Eliminar o actualizar el pago del subpréstamo parcial
          if (partialAmountToRevert >= partialPaymentAmount) {
            await tx.payment.delete({
              where: { id: partialPayment.id },
            });
          } else {
            await tx.payment.update({
              where: { id: partialPayment.id },
              data: {
                amount: new Prisma.Decimal(
                  partialPaymentAmount - partialAmountToRevert,
                ),
              },
            });
          }

          remainingExcess -= partialAmountToRevert;
        }
      }

      // 3. Eliminar todos los pagos del SubLoan
      const paymentsDeleted = await tx.payment.deleteMany({
        where: { subLoanId },
      });

      // 4. Actualizar amountCollected en las rutas del día que contengan este SubLoan
      // Buscar items de rutas activas que contengan este SubLoan
      const routeItems = await tx.collectionRouteItem.findMany({
        where: {
          subLoanId: subLoanId,
          route: {
            status: 'ACTIVE',
          },
        },
        include: {
          route: true,
        },
      });

      // Actualizar amountCollected a 0 en los items de ruta
      for (const item of routeItems) {
        await tx.collectionRouteItem.update({
          where: { id: item.id },
          data: {
            amountCollected: new Prisma.Decimal(0),
          },
        });

        // Recalcular totalCollected y netAmount de la ruta
        const allRouteItems = await tx.collectionRouteItem.findMany({
          where: {
            routeId: item.routeId,
          },
          include: {
            subLoan: {
              select: {
                paidAmount: true,
              },
            },
          },
        });

        const routeTotalCollected = allRouteItems.reduce(
          (sum, routeItem) => sum.add(routeItem.subLoan?.paidAmount ?? new Prisma.Decimal(0)),
          new Prisma.Decimal(0),
        );

        const routeExpenses = await tx.routeExpense.findMany({
          where: {
            routeId: item.routeId,
          },
        });

        const routeTotalExpenses = routeExpenses.reduce(
          (sum, expense) => sum.add(expense.amount),
          new Prisma.Decimal(0),
        );

        const routeNetAmount = routeTotalCollected.sub(routeTotalExpenses);

        await tx.dailyCollectionRoute.update({
          where: { id: item.routeId },
          data: {
            totalCollected: routeTotalCollected,
            totalExpenses: routeTotalExpenses,
            netAmount: routeNetAmount,
          },
        });
      }

      // 5. Resetear el SubLoan y agregar entrada al historial
      const updatedSubLoan = await tx.subLoan.update({
        where: { id: subLoanId },
        data: {
          paidAmount: new Prisma.Decimal(0),
          status: SubLoanStatus.PENDING,
          paidDate: null,
          paymentHistory: this.addResetToPaymentHistory(
            subLoan.paymentHistory,
            totalPaidAmount,
          ),
        },
      });

      return {
        subLoan: updatedSubLoan,
        paymentsDeleted: paymentsDeleted.count,
        totalAmountReset: totalPaidAmount,
        routesUpdated: routeItems.length,
      };
    }, {
      maxWait: 30000,
      timeout: 30000,
    });

    return {
      message: 'Pagos reseteados exitosamente',
      subLoan: {
        id: result.subLoan.id,
        paymentNumber: result.subLoan.paymentNumber,
        status: result.subLoan.status,
        paidAmount: Number(result.subLoan.paidAmount),
        totalAmount: Number(result.subLoan.totalAmount),
        remainingAmount: Number(result.subLoan.totalAmount),
      },
      paymentsDeleted: result.paymentsDeleted,
      totalAmountReset: result.totalAmountReset,
      routesUpdated: result.routesUpdated,
      paymentHistory: result.subLoan.paymentHistory,
    };
  }

  /**
   * Editar el pago de un SubLoan (solo si está completamente pagado)
   * Revierte todos los pagos y aplica el nuevo pago como si fuera el primero
   */
  async editPayment(
    userId: string,
    userRole: UserRole,
    subLoanId: string,
    registerPaymentDto: Omit<RegisterPaymentDto, 'subLoanId'>,
  ): Promise<any> {
    const { amount, currency, paymentDate, description } = registerPaymentDto;

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
        payments: {
          orderBy: { paymentDate: 'asc' },
        },
      },
    });

    if (!subLoan) {
      throw new NotFoundException('SubLoan no encontrado');
    }

    if (subLoan.deletedAt) {
      throw new BadRequestException('SubLoan eliminado');
    }

    // Validar que el SubLoan esté completamente pagado
    if (subLoan.status !== SubLoanStatus.PAID) {
      throw new BadRequestException(
        'Solo se pueden editar pagos de SubLoans que estén completamente pagados',
      );
    }

    // Validar que la fecha del último pago no sea mayor a ayer
    if (subLoan.payments.length === 0) {
      throw new BadRequestException(
        'El SubLoan no tiene pagos registrados',
      );
    }

    const lastPayment = subLoan.payments[subLoan.payments.length - 1];
    const lastPaymentDate = DateUtil.fromPrismaDate(lastPayment.paymentDate);
    const yesterday = DateUtil.now().minus({ days: 1 });
    const lastPaymentDateOnly = lastPaymentDate.toFormat('yyyy-MM-dd');
    const yesterdayDateOnly = yesterday.toFormat('yyyy-MM-dd');
    const todayDateOnly = DateUtil.now().toFormat('yyyy-MM-dd');

    // Solo permitir editar si el último pago fue hoy o ayer
    if (lastPaymentDateOnly < yesterdayDateOnly) {
      throw new BadRequestException(
        `Solo se pueden editar pagos del día actual o de ayer. El último pago fue el ${lastPaymentDateOnly}`,
      );
    }

    // Validar que el usuario tenga acceso
    if (userRole === UserRole.MANAGER) {
      const hasAccess = subLoan.loan.client.managers.some(
        (m) => m.userId === userId,
      );
      if (!hasAccess) {
        throw new ForbiddenException('No tienes acceso a este SubLoan');
      }
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

    // Calcular el monto total de todos los pagos para revertir
    const totalPaidAmount = subLoan.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Realizar la reversión completa y nuevo pago en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Revertir todos los efectos en wallets
      // Revertir crédito en wallet del manager
      await this.walletService.debit({
        userId: managerId,
        amount: totalPaidAmount,
        type: WalletTransactionType.LOAN_PAYMENT,
        description: `Reversión completa pagos SubLoan ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
        transaction: tx,
      });

      // Revertir registro en collector wallet
      const collectorWallet = await this.collectorWalletService.getOrCreateWallet(
        managerId,
        tx,
      );
      const collectorBalanceBefore = Number(collectorWallet.balance);
      const collectorBalanceAfter = collectorBalanceBefore - totalPaidAmount;

      await tx.collectorWallet.update({
        where: { id: collectorWallet.id },
        data: {
          balance: {
            decrement: new Prisma.Decimal(totalPaidAmount),
          },
        },
      });

      // Crear transacción de reversión en collector wallet
      await tx.collectorWalletTransaction.create({
        data: {
          walletId: collectorWallet.id,
          userId: managerId,
          type: CollectorWalletTransactionType.COLLECTION,
          amount: new Prisma.Decimal(-totalPaidAmount),
          currency: collectorWallet.currency,
          description: `Reversión completa cobros SubLoan ${subLoan.loan.client.fullName} - Cuota #${subLoan.paymentNumber}`,
          balanceBefore: new Prisma.Decimal(collectorBalanceBefore),
          balanceAfter: new Prisma.Decimal(collectorBalanceAfter),
          subLoanId,
        },
      });

      // 2. Buscar y revertir excedentes en subloans parciales anteriores
      // Obtener todos los pagos para calcular excedentes distribuidos
      const currentSubLoanTotalAmount = Number(subLoan.totalAmount);
      const excessAmount = totalPaidAmount - currentSubLoanTotalAmount;

      if (excessAmount > 0) {
        // Buscar subpréstamos parciales anteriores que recibieron el excedente
        const partialSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { lt: subLoan.paymentNumber },
            status: SubLoanStatus.PARTIAL,
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'desc' },
        });

        // Obtener todos los pagos de los subloans parciales en batch
        const partialSubLoanIds = partialSubLoans.map((p) => p.id);
        const allPartialPayments =
          partialSubLoanIds.length > 0
            ? await tx.payment.findMany({
                where: {
                  subLoanId: { in: partialSubLoanIds },
                },
                orderBy: [
                  { subLoanId: 'asc' },
                  { paymentDate: 'desc' },
                ],
              })
            : [];

        // Agrupar pagos por subLoanId y tomar el más reciente de cada uno
        const paymentsBySubLoan = new Map<string, any>();
        for (const payment of allPartialPayments) {
          if (!paymentsBySubLoan.has(payment.subLoanId)) {
            paymentsBySubLoan.set(payment.subLoanId, payment);
          }
        }

        // Revertir excedentes de subloans parciales
        let remainingExcess = excessAmount;
        for (const partial of partialSubLoans) {
          if (remainingExcess <= 0) break;

          const partialPayment = paymentsBySubLoan.get(partial.id);
          if (!partialPayment) continue;

          const partialPaymentAmount = Number(partialPayment.amount);
          const partialAmountToRevert = Math.min(
            remainingExcess,
            partialPaymentAmount,
          );

          const partialPreviousPaidAmount =
            Number(partial.paidAmount) - partialAmountToRevert;

          await tx.subLoan.update({
            where: { id: partial.id },
            data: {
              paidAmount: new Prisma.Decimal(
                Math.max(0, partialPreviousPaidAmount),
              ),
              status:
                partialPreviousPaidAmount > 0
                  ? SubLoanStatus.PARTIAL
                  : SubLoanStatus.PENDING,
              paidDate:
                partialPreviousPaidAmount > 0 ? partial.paidDate : null,
              paymentHistory: this.removeLastPaymentFromHistory(
                partial.paymentHistory,
              ),
            },
          });

          // Eliminar o actualizar el pago del subpréstamo parcial
          if (partialAmountToRevert >= partialPaymentAmount) {
            await tx.payment.delete({
              where: { id: partialPayment.id },
            });
          } else {
            await tx.payment.update({
              where: { id: partialPayment.id },
              data: {
                amount: new Prisma.Decimal(
                  partialPaymentAmount - partialAmountToRevert,
                ),
              },
            });
          }

          remainingExcess -= partialAmountToRevert;
        }
      }

      // 3. Eliminar todos los pagos del SubLoan actual
      await tx.payment.deleteMany({
        where: { subLoanId },
      });

      // 4. Resetear el SubLoan a estado inicial
      await tx.subLoan.update({
        where: { id: subLoanId },
        data: {
          paidAmount: new Prisma.Decimal(0),
          status: SubLoanStatus.PENDING,
          paidDate: null,
          paymentHistory: Prisma.JsonNull,
        },
      });

      // 5. Aplicar el nuevo pago como si fuera el primero
      // IMPORTANTE: Cuando se edita un pago, SIEMPRE queda en estado PARTIAL (nunca PAID)
      // porque el pago editable siempre es mayor a 0
      let remainingAmount = amount;
      const distributedPayments: any[] = [];

      // Procesar el pago del SubLoan actual
      // Siempre aplicar como pago parcial, incluso si el monto es suficiente
      const newPaidAmount = Math.min(remainingAmount, Number(subLoan.totalAmount));
      const newRemainingAmount = Number(subLoan.totalAmount) - newPaidAmount;

      let updatedSubLoan: any;

      // Siempre dejar en PARTIAL cuando se edita
      updatedSubLoan = await tx.subLoan.update({
        where: { id: subLoanId },
        data: {
          paidAmount: new Prisma.Decimal(newPaidAmount),
          status: SubLoanStatus.PARTIAL,
          paidDate: paymentDate
            ? DateUtil.parseToDate(paymentDate)
            : DateUtil.now().toJSDate(),
          paymentHistory: this.addToPaymentHistory(
            null,
            newPaidAmount,
            newRemainingAmount,
            paymentDate,
          ),
        },
      });

      distributedPayments.push({
        subLoanId: subLoan.id,
        paymentNumber: subLoan.paymentNumber,
        distributedAmount: newPaidAmount,
        newStatus: SubLoanStatus.PARTIAL,
        newPaidAmount,
      });

      // Calcular el excedente después de aplicar al SubLoan actual
      remainingAmount -= newPaidAmount;

      // Si hay excedente, buscar SubLoans anteriores PARTIAL
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

      // 6. Crear registro del nuevo pago
      const payment = await tx.payment.create({
        data: {
          subLoanId,
          amount: new Prisma.Decimal(amount),
          currency,
          paymentDate: paymentDate
            ? DateUtil.parseToDate(paymentDate)
            : DateUtil.now().toJSDate(),
          description: description || `Pago editado SubLoan #${subLoan.paymentNumber}`,
        },
      });

      // 7. Acreditar a la cartera del manager
      await this.walletService.credit({
        userId: managerId,
        amount,
        type: WalletTransactionType.LOAN_PAYMENT,
        description: `Pago editado préstamo ${subLoan.loan.loanTrack} - Cuota #${subLoan.paymentNumber}`,
        transaction: tx,
      });

      // 8. Registrar el cobro en la wallet del cobrador
      await this.collectorWalletService.recordCollection({
        userId: managerId,
        amount,
        description: `Cobro editado préstamo ${subLoan.loan.client.fullName} - Cuota #${subLoan.paymentNumber}`,
        subLoanId,
        transaction: tx,
      });

      return {
        payment,
        subLoan: updatedSubLoan,
        distributedPayments,
      };
    }, {
      maxWait: 30000,
      timeout: 30000,
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
}
