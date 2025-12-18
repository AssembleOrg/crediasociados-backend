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

      // 2. Si hay excedente, primero cubrir SubLoans ANTERIORES no pagados (OVERDUE/PENDING/PARTIAL)
      // Regla: primero la cuota seleccionada, luego anteriores, luego futuras.
      if (remainingAmount > 0) {
        const previousSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { lt: subLoan.paymentNumber },
            status: {
              in: [SubLoanStatus.OVERDUE, SubLoanStatus.PENDING, SubLoanStatus.PARTIAL],
            },
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'desc' },
        });

        for (const prev of previousSubLoans) {
          if (remainingAmount <= 0) break;

          const prevRemaining =
            Number(prev.totalAmount) - Number(prev.paidAmount);
          if (prevRemaining <= 0) continue;

          if (remainingAmount >= prevRemaining) {
            await tx.subLoan.update({
              where: { id: prev.id },
              data: {
                paidAmount: prev.totalAmount,
                status: SubLoanStatus.PAID,
                paidDate: paymentDate
                  ? DateUtil.parseToDate(paymentDate)
                  : DateUtil.now().toJSDate(),
                paymentHistory: this.addToPaymentHistory(
                  prev.paymentHistory,
                  prevRemaining,
                  0,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: prev.id,
              paymentNumber: prev.paymentNumber,
              distributedAmount: prevRemaining,
              newStatus: SubLoanStatus.PAID,
              newPaidAmount: Number(prev.totalAmount),
            });

            remainingAmount -= prevRemaining;
          } else {
            const newPrevPaid = Number(prev.paidAmount) + remainingAmount;
            const newPrevRemaining = Number(prev.totalAmount) - newPrevPaid;

            await tx.subLoan.update({
              where: { id: prev.id },
              data: {
                paidAmount: new Prisma.Decimal(newPrevPaid),
                status: SubLoanStatus.PARTIAL,
                paymentHistory: this.addToPaymentHistory(
                  prev.paymentHistory,
                  remainingAmount,
                  newPrevRemaining,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: prev.id,
              paymentNumber: prev.paymentNumber,
              distributedAmount: remainingAmount,
              newStatus: SubLoanStatus.PARTIAL,
              newPaidAmount: newPrevPaid,
            });

            remainingAmount = 0;
          }
        }
      }

      // 3. Si hay excedente, buscar SubLoans SIGUIENTES no pagados (PENDING o PARTIAL)
      // El excedente restante se usa para adelantar pagos de cuotas posteriores
      if (remainingAmount > 0) {
        const nextSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { gt: subLoan.paymentNumber },
            status: { in: [SubLoanStatus.PENDING, SubLoanStatus.PARTIAL] },
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'asc' },
        });

        for (const nextSubLoan of nextSubLoans) {
          if (remainingAmount <= 0) break;

          const nextRemainingAmount =
            Number(nextSubLoan.totalAmount) - Number(nextSubLoan.paidAmount);

          if (remainingAmount >= nextRemainingAmount) {
            // Completar este SubLoan
            await tx.subLoan.update({
              where: { id: nextSubLoan.id },
              data: {
                paidAmount: nextSubLoan.totalAmount,
                status: SubLoanStatus.PAID,
                paidDate: paymentDate
                  ? DateUtil.parseToDate(paymentDate)
                  : DateUtil.now().toJSDate(),
                paymentHistory: this.addToPaymentHistory(
                  nextSubLoan.paymentHistory,
                  nextRemainingAmount,
                  0,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: nextSubLoan.id,
              paymentNumber: nextSubLoan.paymentNumber,
              distributedAmount: nextRemainingAmount,
              newStatus: SubLoanStatus.PAID,
              newPaidAmount: Number(nextSubLoan.totalAmount),
            });

            remainingAmount -= nextRemainingAmount;
          } else {
            // Pago parcial a este SubLoan (el excedente no alcanza para completar)
            const newPaidAmount = Number(nextSubLoan.paidAmount) + remainingAmount;
            const newRemainingAmount =
              Number(nextSubLoan.totalAmount) - newPaidAmount;

            await tx.subLoan.update({
              where: { id: nextSubLoan.id },
              data: {
                paidAmount: new Prisma.Decimal(newPaidAmount),
                status: SubLoanStatus.PARTIAL,
                paymentHistory: this.addToPaymentHistory(
                  nextSubLoan.paymentHistory,
                  remainingAmount,
                  newRemainingAmount,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: nextSubLoan.id,
              paymentNumber: nextSubLoan.paymentNumber,
              distributedAmount: remainingAmount,
              newStatus: SubLoanStatus.PARTIAL,
              newPaidAmount,
            });

            remainingAmount = 0;
          }
        }
      }

      // 4. Crear registro de pago
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

      // 3a. Marcar en paymentHistory qué pago origen generó estas actualizaciones
      // Esto permite resetear adelantados desde cualquier cuota afectada.
      const affectedSubLoanIds = Array.from(
        new Set([
          subLoanId,
          ...distributedPayments.map((dp) => dp.subLoanId),
        ]),
      );

      for (const affectedId of affectedSubLoanIds) {
        const sl = await tx.subLoan.findUnique({
          where: { id: affectedId },
          select: { paymentHistory: true },
        });

        const hist = Array.isArray(sl?.paymentHistory) ? (sl!.paymentHistory as any[]) : [];
        if (hist.length === 0) continue;

        const last = hist[hist.length - 1];
        if (last && typeof last === 'object' && !('sourcePaymentId' in last)) {
          last.sourcePaymentId = payment.id;
          await tx.subLoan.update({
            where: { id: affectedId },
            data: {
              paymentHistory: hist as any,
            },
          });
        }
      }

      // 3b. Actualizar totalCollectedPayments de la ruta del día (sin tocar wallets/safe)
      // Nota: routeDate se guarda como inicio del día en Buenos Aires
      await this.recalcRouteTotalCollectedPaymentsForDay({
        tx,
        managerId,
        day: payment.createdAt,
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
   * Recalcula y persiste el total cobrado real del día en la ruta:
   * totalCollectedPayments = SUM(payments.amount) del día (createdAt) para el manager.
   *
   * Importante: NO toca safe ni collector wallet; solo lee payments y actualiza daily_collection_routes.
   */
  private async recalcRouteTotalCollectedPaymentsForDay(params: {
    tx: Prisma.TransactionClient;
    managerId: string;
    day: Date; // cualquier hora, se normaliza a start/end of day (Buenos Aires)
  }): Promise<void> {
    const { tx, managerId, day } = params;
    const dayStart = DateUtil.startOfDay(DateUtil.fromJSDate(day)).toJSDate();
    const dayEnd = DateUtil.endOfDay(DateUtil.fromJSDate(day)).toJSDate();

    const paymentsSum = await tx.payment.aggregate({
      where: {
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        subLoan: {
          loan: {
            managerId: managerId,
          },
        },
      },
      _sum: {
        amount: true,
      },
    });

    await tx.dailyCollectionRoute.updateMany({
      where: {
        managerId: managerId,
        routeDate: dayStart,
      },
      data: {
        totalCollectedPayments: paymentsSum._sum.amount ?? new Prisma.Decimal(0),
      },
    });
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
    sourcePaymentId?: string,
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
        ...(sourcePaymentId ? { sourcePaymentId } : {}),
      },
    ];
  }

  /**
   * Helper: Remover entradas del historial asociadas a un payment origen
   */
  private removePaymentFromHistory(
    currentHistory: any,
    sourcePaymentId: string,
  ): any {
    const history = Array.isArray(currentHistory) ? currentHistory : [];
    return history.filter((h: any) => h?.sourcePaymentId !== sourcePaymentId);
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

    // Si no hay payments, puede ser una cuota pagada por adelantado.
    // En ese caso, buscar el payment origen en paymentHistory y redirigir el reset al subLoan que sí tiene el payment.
    if (subLoan.payments.length === 0) {
      const paymentHistory = Array.isArray(subLoan.paymentHistory)
        ? (subLoan.paymentHistory as any[])
        : [];
      const lastWithSource = [...paymentHistory]
        .reverse()
        .find((h: any) => h && typeof h === 'object' && h.sourcePaymentId);

      if (!lastWithSource?.sourcePaymentId) {
        throw new BadRequestException('El SubLoan no tiene pagos para resetear');
      }

      const sourcePayment = await this.prisma.payment.findUnique({
        where: { id: String(lastWithSource.sourcePaymentId) },
      });

      if (!sourcePayment) {
        throw new BadRequestException('El SubLoan no tiene pagos para resetear');
      }

      // Reintentar reseteo sobre el subLoan que contiene el payment origen
      return this.resetSubLoanPayments(
        sourcePayment.subLoanId,
        userId,
        userRole,
      );
    }

    // Validar que el último pago no sea mayor a 24 horas
    const lastPayment = subLoan.payments[0];
    const lastPaymentDate = DateUtil.fromPrismaDate(lastPayment.paymentDate);
    const now = DateUtil.now();
    const hoursDiff = now.diff(lastPaymentDate, 'hours').hours;

    if (hoursDiff > 20) {
      throw new BadRequestException(
        `No se puede resetear: el último pago fue hace ${Math.floor(hoursDiff)} horas. Solo se permiten reseteos de pagos realizados en las últimas 20 horas.`,
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

    // Días afectados (createdAt) para recalcular totalCollectedPayments de la ruta
    const affectedDays = Array.from(
      new Set(
        subLoan.payments.map((p) =>
          DateUtil.fromPrismaDate(p.createdAt).toFormat('yyyy-MM-dd'),
        ),
      ),
    ).map((isoDate) => DateUtil.parseToDate(isoDate));

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

      // 3b. Revertir cuotas adicionales pagadas por el mismo payment (adelantos)
      // Usamos sourcePaymentId en paymentHistory para encontrar subloans afectados.
      const sourcePaymentId = lastPayment.id;
      const loanSubLoans = await tx.subLoan.findMany({
        where: {
          loanId: subLoan.loanId,
          deletedAt: null,
        },
        select: {
          id: true,
          totalAmount: true,
          paidAmount: true,
          status: true,
          paidDate: true,
          paymentHistory: true,
        },
      });

      for (const sl of loanSubLoans) {
        if (sl.id === subLoanId) continue;
        const hist = Array.isArray(sl.paymentHistory)
          ? (sl.paymentHistory as any[])
          : [];
        const relatedEntries = hist.filter(
          (h: any) => h && typeof h === 'object' && h.sourcePaymentId === sourcePaymentId,
        );
        if (relatedEntries.length === 0) continue;

        const amountToRevert = relatedEntries.reduce(
          (sum: number, h: any) => sum + Number(h.amount || 0),
          0,
        );
        if (amountToRevert <= 0) continue;

        const newPaid = Math.max(0, Number(sl.paidAmount) - amountToRevert);
        const total = Number(sl.totalAmount);
        const newStatus =
          newPaid <= 0
            ? SubLoanStatus.PENDING
            : newPaid >= total
              ? SubLoanStatus.PAID
              : SubLoanStatus.PARTIAL;

        await tx.subLoan.update({
          where: { id: sl.id },
          data: {
            paidAmount: new Prisma.Decimal(newPaid),
            status: newStatus,
            paidDate: newStatus === SubLoanStatus.PAID ? sl.paidDate : null,
            paymentHistory: this.removePaymentFromHistory(hist, sourcePaymentId),
          },
        });
      }

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

      // Recalcular totalCollectedPayments para los días afectados
      for (const day of affectedDays) {
        await this.recalcRouteTotalCollectedPaymentsForDay({
          tx,
          managerId,
          day,
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

    // Días afectados antes del cambio (createdAt) para recalcular totalCollectedPayments de la ruta
    const affectedDaysBefore = Array.from(
      new Set(
        subLoan.payments.map((p) =>
          DateUtil.fromPrismaDate(p.createdAt).toFormat('yyyy-MM-dd'),
        ),
      ),
    ).map((isoDate) => DateUtil.parseToDate(isoDate));

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

      // Si hay excedente, primero cubrir SubLoans ANTERIORES no pagados (OVERDUE/PENDING/PARTIAL)
      // Regla: primero la cuota seleccionada, luego anteriores, luego futuras.
      if (remainingAmount > 0) {
        const previousSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { lt: subLoan.paymentNumber },
            status: {
              in: [SubLoanStatus.OVERDUE, SubLoanStatus.PENDING, SubLoanStatus.PARTIAL],
            },
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'desc' },
        });

        for (const prev of previousSubLoans) {
          if (remainingAmount <= 0) break;

          const prevRemainingAmount =
            Number(prev.totalAmount) - Number(prev.paidAmount);
          if (prevRemainingAmount <= 0) continue;

          if (remainingAmount >= prevRemainingAmount) {
            // Completar este SubLoan anterior
            await tx.subLoan.update({
              where: { id: prev.id },
              data: {
                paidAmount: prev.totalAmount,
                status: SubLoanStatus.PAID,
                paidDate: paymentDate
                  ? DateUtil.parseToDate(paymentDate)
                  : DateUtil.now().toJSDate(),
                paymentHistory: this.addToPaymentHistory(
                  prev.paymentHistory,
                  prevRemainingAmount,
                  0,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: prev.id,
              paymentNumber: prev.paymentNumber,
              distributedAmount: prevRemainingAmount,
              newStatus: SubLoanStatus.PAID,
              newPaidAmount: Number(prev.totalAmount),
            });

            remainingAmount -= prevRemainingAmount;
          } else {
            // Pago parcial a este SubLoan anterior
            const newPaidAmount = Number(prev.paidAmount) + remainingAmount;
            const newRemainingAmount =
              Number(prev.totalAmount) - newPaidAmount;

            await tx.subLoan.update({
              where: { id: prev.id },
              data: {
                paidAmount: new Prisma.Decimal(newPaidAmount),
                status: SubLoanStatus.PARTIAL,
                paymentHistory: this.addToPaymentHistory(
                  prev.paymentHistory,
                  remainingAmount,
                  newRemainingAmount,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: prev.id,
              paymentNumber: prev.paymentNumber,
              distributedAmount: remainingAmount,
              newStatus: SubLoanStatus.PARTIAL,
              newPaidAmount,
            });

            remainingAmount = 0;
          }
        }
      }

      // Si queda excedente, recién ahí pagar SubLoans SIGUIENTES (adelantos)
      if (remainingAmount > 0) {
        const nextSubLoans = await tx.subLoan.findMany({
          where: {
            loanId: subLoan.loanId,
            paymentNumber: { gt: subLoan.paymentNumber },
            status: { in: [SubLoanStatus.PENDING, SubLoanStatus.PARTIAL] },
            deletedAt: null,
          },
          orderBy: { paymentNumber: 'asc' },
        });

        for (const nextSubLoan of nextSubLoans) {
          if (remainingAmount <= 0) break;

          const nextRemainingAmount =
            Number(nextSubLoan.totalAmount) - Number(nextSubLoan.paidAmount);
          if (nextRemainingAmount <= 0) continue;

          if (remainingAmount >= nextRemainingAmount) {
            await tx.subLoan.update({
              where: { id: nextSubLoan.id },
              data: {
                paidAmount: nextSubLoan.totalAmount,
                status: SubLoanStatus.PAID,
                paidDate: paymentDate
                  ? DateUtil.parseToDate(paymentDate)
                  : DateUtil.now().toJSDate(),
                paymentHistory: this.addToPaymentHistory(
                  nextSubLoan.paymentHistory,
                  nextRemainingAmount,
                  0,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: nextSubLoan.id,
              paymentNumber: nextSubLoan.paymentNumber,
              distributedAmount: nextRemainingAmount,
              newStatus: SubLoanStatus.PAID,
              newPaidAmount: Number(nextSubLoan.totalAmount),
            });

            remainingAmount -= nextRemainingAmount;
          } else {
            const newPaidAmount = Number(nextSubLoan.paidAmount) + remainingAmount;
            const newRemainingAmount =
              Number(nextSubLoan.totalAmount) - newPaidAmount;

            await tx.subLoan.update({
              where: { id: nextSubLoan.id },
              data: {
                paidAmount: new Prisma.Decimal(newPaidAmount),
                status: SubLoanStatus.PARTIAL,
                paymentHistory: this.addToPaymentHistory(
                  nextSubLoan.paymentHistory,
                  remainingAmount,
                  newRemainingAmount,
                  paymentDate,
                ),
              },
            });

            distributedPayments.push({
              subLoanId: nextSubLoan.id,
              paymentNumber: nextSubLoan.paymentNumber,
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

      // Marcar sourcePaymentId en la última entrada de paymentHistory del subloan editado (y parciales si aplica)
      const subLoanAfter = await tx.subLoan.findUnique({
        where: { id: subLoanId },
        select: { paymentHistory: true },
      });
      const hist = Array.isArray(subLoanAfter?.paymentHistory)
        ? (subLoanAfter!.paymentHistory as any[])
        : [];
      if (hist.length > 0) {
        const last = hist[hist.length - 1];
        if (last && typeof last === 'object') {
          last.sourcePaymentId = payment.id;
          await tx.subLoan.update({
            where: { id: subLoanId },
            data: { paymentHistory: hist as any },
          });
        }
      }

      // 6b. Recalcular totalCollectedPayments para los días afectados (antes y el día del nuevo pago)
      const affectedDays = [
        ...affectedDaysBefore,
        DateUtil.parseToDate(
          DateUtil.fromJSDate(payment.createdAt).toFormat('yyyy-MM-dd'),
        ),
      ];
      const uniqueAffectedDays = Array.from(
        new Set(affectedDays.map((d) => DateUtil.fromJSDate(d).toISODate())),
      ).map((isoDate) => DateUtil.parseToDate(isoDate!));

      for (const day of uniqueAffectedDays) {
        await this.recalcRouteTotalCollectedPaymentsForDay({
          tx,
          managerId,
          day,
        });
      }

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
