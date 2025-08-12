import { ApiProperty } from '@nestjs/swagger';

export class LoanTrackingResponseDto {
  @ApiProperty({ example: 'loan_id_here' })
  id: string;

  @ApiProperty({ example: 'LOAN-2024-001' })
  loanTrack: string;

  @ApiProperty({ example: 100000.00 })
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

  @ApiProperty({ example: 'Business expansion loan' })
  description?: string;

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
        totalAmount: 9583.33,
        status: 'PENDING',
        dueDate: '2024-02-02T00:00:00.000Z',
        paidDate: null,
        paidAmount: 0,
        daysOverdue: 0,
      },
    ],
  })
  subLoans: Array<{
    id: string;
    paymentNumber: number;
    amount: number;
    totalAmount: number;
    status: string;
    dueDate: string;
    paidDate?: string;
    paidAmount: number;
    daysOverdue: number;
  }>;
} 