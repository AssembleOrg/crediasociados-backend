import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LoansService } from './loans.service';
import { TrackingCodeUtil } from '../common/utils';

const D = (n: number) => new Prisma.Decimal(n);

// Préstamo con 3 cuotas impagas de $12.000 (saldo $36.000), una con $2.000 a cuenta.
function buildLoan() {
  return {
    id: 'loan-1',
    loanTrack: 'CREDITO-2026-00001',
    clientId: 'client-1',
    managerId: 'mgr-1',
    status: 'ACTIVE',
    currency: 'ARS',
    amount: D(420000),
    client: { id: 'client-1', fullName: 'Cliente Prueba', verified: true },
    subLoans: [
      { id: 'sl-33', paymentNumber: 33, status: 'PARTIAL', totalAmount: D(12000), paidAmount: D(2000), originalTotalAmount: null },
      { id: 'sl-34', paymentNumber: 34, status: 'OVERDUE', totalAmount: D(12000), paidAmount: D(0), originalTotalAmount: null },
      { id: 'sl-35', paymentNumber: 35, status: 'PENDING', totalAmount: D(12000), paidAmount: D(0), originalTotalAmount: null },
    ],
  };
}

function setup() {
  const tx = {
    subLoan: { update: jest.fn() },
    payment: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: D(0) } }) },
    loan: { update: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'loan-new' }) },
    dailyCollectionRoute: { updateMany: jest.fn() },
  };
  const prisma = {
    loan: {
      findFirst: jest.fn().mockResolvedValue(buildLoan()),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Darwin', createdById: 'subadmin-1' }) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const collectorWalletService = {
    getOrCreateWallet: jest.fn().mockResolvedValue({ currency: 'ARS' }),
    recordCollection: jest.fn(),
    recordLoanDisbursement: jest.fn(),
  };
  const walletService = { credit: jest.fn() };
  const notificationsService = { notify: jest.fn() };
  const service = new LoansService(
    prisma as any,
    { generateSubLoans: jest.fn() } as any,
    collectorWalletService as any,
    walletService as any,
    { generateLoanPdf: jest.fn().mockResolvedValue({ pdfBase64: '', filename: 'x.pdf' }) } as any,
    notificationsService as any,
  );
  return { service, tx, prisma, walletService, collectorWalletService, notificationsService };
}

const dto = {
  amount: 500000,
  baseInterestRate: 0.4,
  penaltyInterestRate: 0,
  paymentFrequency: 'DAILY',
  totalPayments: 35,
  firstDueDate: '2026-10-28',
} as any;

describe('LoansService.renewLoan — monto para cancelar', () => {
  beforeEach(() => {
    jest
      .spyOn(TrackingCodeUtil, 'generateSequentialTrackingCode')
      .mockResolvedValue({ trackingCode: 'CREDITO-2026-00002', prefix: 'CREDITO', year: 2026, sequence: 2 } as any);
  });

  it('sin settlementAmount cobra el saldo completo y no condona', async () => {
    const { service, tx, walletService, collectorWalletService, notificationsService } = setup();
    const res = await service.renewLoan('loan-1', 'mgr-1', dto);

    expect(res.previousLoan).toMatchObject({ settledAmount: 34000, forgivenAmount: 0 });
    expect(tx.payment.create.mock.calls[0][0].data.amount).toEqual(D(34000));
    for (const [call] of tx.subLoan.update.mock.calls) {
      expect(call.data.totalAmount).toBeUndefined();
      expect(call.data.status).toBe('PAID');
    }
    expect(tx.subLoan.update.mock.calls.map(([c]) => Number(c.data.paidAmount))).toEqual([12000, 12000, 12000]);
    expect(tx.loan.update.mock.calls[0][0].data.forgivenAmount).toBeUndefined();
    expect(walletService.credit.mock.calls[0][0].amount).toBe(34000);
    expect(collectorWalletService.recordCollection.mock.calls[0][0].amount).toBe(34000);
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('con descuento cobra lo acordado, condona la diferencia y avisa al subadmin', async () => {
    const { service, tx, walletService, collectorWalletService, notificationsService } = setup();
    const res = await service.renewLoan('loan-1', 'mgr-1', { ...dto, settlementAmount: 20000 });

    expect(res.previousLoan).toMatchObject({ settledAmount: 20000, forgivenAmount: 14000 });
    // $20.000 se reparten en orden: completa la 33 ($10.000), la 34 ($10.000 de 12.000), la 35 queda en 0
    const updates = tx.subLoan.update.mock.calls.map(([c]) => c);
    expect(updates.map((c) => Number(c.data.paidAmount))).toEqual([12000, 10000, 0]);
    expect(updates[0].data.totalAmount).toBeUndefined();
    expect(Number(updates[1].data.totalAmount)).toBe(10000);
    expect(Number(updates[1].data.originalTotalAmount)).toBe(12000);
    expect(Number(updates[2].data.totalAmount)).toBe(0);

    const loanData = tx.loan.update.mock.calls[0][0].data;
    expect(loanData.amount).toEqual({ decrement: D(14000) });
    expect(loanData.forgivenAmount).toEqual({ increment: D(14000) });
    expect(tx.payment.create.mock.calls[0][0].data.amount).toEqual(D(20000));
    expect(walletService.credit.mock.calls[0][0].amount).toBe(20000);
    expect(collectorWalletService.recordCollection.mock.calls[0][0].amount).toBe(20000);
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'subadmin-1', title: 'Renovación con descuento' }),
    );
  });

  it('rechaza un monto mayor al saldo', async () => {
    const { service, prisma } = setup();
    await expect(
      service.renewLoan('loan-1', 'mgr-1', { ...dto, settlementAmount: 34001 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
