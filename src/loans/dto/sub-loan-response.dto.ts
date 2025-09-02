import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '../../common/transformers/decimal.transformer';

export class SubLoanResponseDto {
  @ApiProperty({ example: 'subloan_id_1' })
  id: string;

  @ApiProperty({ example: 'loan_id_1' })
  loanId: string;

  @ApiProperty({ example: 1 })
  paymentNumber: number;

  @ApiProperty({ example: 8333.33 })
  @ToNumber()
  amount: number;

  @ApiProperty({ example: 8333.33 })
  @ToNumber()
  totalAmount: number;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: '2024-02-02T00:00:00.000Z' })
  dueDate: string;

  @ApiProperty({ example: null, required: false })
  paidDate?: string | null;

  @ApiProperty({ example: 0 })
  @ToNumber()
  paidAmount: number;

  @ApiProperty({ example: 0 })
  daysOverdue: number;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({ example: null, required: false })
  deletedAt?: string | null;
}
