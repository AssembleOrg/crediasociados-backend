import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '../../common/transformers/decimal.transformer';

export class WalletHistoryItemDto {
  @ApiProperty({ example: 'transaction_id_here' })
  id: string;

  @ApiProperty({ example: 'COLLECTION' })
  type: string;

  @ApiProperty({ example: 50000.0 })
  @ToNumber()
  amount: number;

  @ApiProperty({ example: 'ARS' })
  currency: string;

  @ApiProperty({ example: 'Cobro préstamo LOAN-2024-001 - Cuota #1' })
  description: string;

  @ApiProperty({ example: 100000.0 })
  @ToNumber()
  balanceBefore: number;

  @ApiProperty({ example: 150000.0 })
  @ToNumber()
  balanceAfter: number;

  @ApiProperty({ example: 'subloan_id_here', required: false })
  subLoanId?: string;

  @ApiProperty({ example: '2024-11-11T10:30:00.000Z' })
  createdAt: Date;
}

export class WalletHistoryDto {
  @ApiProperty({ example: 50, type: Number })
  total: number;

  @ApiProperty({ type: [WalletHistoryItemDto] })
  transactions: WalletHistoryItemDto[];
}
