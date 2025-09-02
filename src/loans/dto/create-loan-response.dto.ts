import { ApiProperty } from '@nestjs/swagger';

export class CreateLoanResponseDto {
  @ApiProperty({ example: 'loan_id_here' })
  id: string;

  @ApiProperty({ example: 'LOAN-2024-001' })
  loanTrack: string;

  @ApiProperty({ example: 100000.0 })
  amount: number;

  @ApiProperty({ example: 'ARS' })
  currency: string;

  @ApiProperty({ example: 'WEEKLY' })
  paymentFrequency: string;

  @ApiProperty({ example: 'FRIDAY' })
  paymentDay?: string;

  @ApiProperty({ example: 12 })
  totalPayments: number;

  @ApiProperty({ example: '2024-02-02T00:00:00.000Z' })
  firstDueDate?: string;

  @ApiProperty({ example: 15.0 })
  baseInterestRate: number;

  @ApiProperty({ example: 35.0 })
  penaltyInterestRate: number;

  @ApiProperty({ example: 'Business expansion loan' })
  description?: string;

  @ApiProperty({ example: 'Client requested weekly payments on Fridays' })
  notes?: string;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    example: {
      id: 'client_id',
      fullName: 'John Doe',
      dni: '12345678',
      cuit: '20-12345678-9',
      phone: '+1234567890',
      email: 'client@example.com',
      address: '123 Main St, Buenos Aires',
    },
  })
  client: {
    id: string;
    fullName: string;
    dni?: string;
    cuit?: string;
    phone?: string;
    email?: string;
    address?: string;
  };

  @ApiProperty({
    example: [
      {
        id: 'subloan_id_1',
        paymentNumber: 1,
        amount: 8333.33,
        totalAmount: 8333.33,
        status: 'PENDING',
        dueDate: '2024-02-02T00:00:00.000Z',
        paidAmount: 0,
        daysOverdue: 0,
      },
      {
        id: 'subloan_id_2',
        paymentNumber: 2,
        amount: 8333.33,
        totalAmount: 8333.33,
        status: 'PENDING',
        dueDate: '2024-02-09T00:00:00.000Z',
        paidAmount: 0,
        daysOverdue: 0,
      },
    ],
    description: 'SubLoans generados automáticamente basados en totalPayments',
  })
  subLoans: Array<{
    id: string;
    paymentNumber: number;
    amount: number;
    totalAmount: number;
    status: string;
    dueDate: string;
    paidAmount: number;
    daysOverdue: number;
  }>;
}
