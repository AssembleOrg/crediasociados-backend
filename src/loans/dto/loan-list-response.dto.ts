import { ApiProperty } from '@nestjs/swagger';
import {
  ToNumber,
  ToNumberArray,
} from '../../common/transformers/decimal.transformer';
import { SubLoanResponseDto } from './sub-loan-response.dto';

export class ClientBasicInfoDto {
  @ApiProperty({ example: 'client_id' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  fullName: string;

  @ApiProperty({ example: '12345678', required: false })
  dni?: string | null;

  @ApiProperty({ example: '20-12345678-9', required: false })
  cuit?: string | null;
}

export class LoanListResponseDto {
  @ApiProperty({ example: 'loan_id_1' })
  id: string;

  @ApiProperty({ example: 'client_id_1' })
  clientId: string;

  @ApiProperty({ example: 100000.0 })
  @ToNumber()
  amount: number;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  requestDate: string;

  @ApiProperty({ example: null, required: false })
  approvedDate?: string | null;

  @ApiProperty({ example: null, required: false })
  completedDate?: string | null;

  @ApiProperty({ example: 'Business expansion loan', required: false })
  description?: string | null;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-15T00:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({ example: null, required: false })
  deletedAt?: string | null;

  @ApiProperty({ example: 15.0 })
  @ToNumber()
  baseInterestRate: number;

  @ApiProperty({ example: 'ARS' })
  currency: string;

  @ApiProperty({ example: '2024-02-02T00:00:00.000Z', required: false })
  firstDueDate?: string | null;

  @ApiProperty({ example: 'Client requested weekly payments', required: false })
  notes?: string | null;

  @ApiProperty({ example: 'FRIDAY', required: false })
  paymentDay?: string | null;

  @ApiProperty({ example: 'WEEKLY' })
  paymentFrequency: string;

  @ApiProperty({ example: 35.0 })
  @ToNumber()
  penaltyInterestRate: number;

  @ApiProperty({ example: 5 })
  totalPayments: number;

  @ApiProperty({ example: 'LOAN-2024-001' })
  loanTrack: string;

  @ApiProperty({ example: 'CREDITO' })
  prefix: string;

  @ApiProperty({ example: 2024 })
  year: number;

  @ApiProperty({ example: 1 })
  sequence: number;

  @ApiProperty({ example: 100000.0 })
  @ToNumber()
  originalAmount: number;

  @ApiProperty({ type: ClientBasicInfoDto })
  client: ClientBasicInfoDto;

  @ApiProperty({ type: [SubLoanResponseDto] })
  @ToNumberArray(['amount', 'totalAmount', 'paidAmount'])
  subLoans: SubLoanResponseDto[];
}
