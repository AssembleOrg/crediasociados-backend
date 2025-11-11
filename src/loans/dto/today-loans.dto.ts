import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '../../common/transformers/decimal.transformer';

export class TodayLoanItemDto {
  @ApiProperty({ example: 100000.0 })
  @ToNumber()
  montoTotalPrestado: number;

  @ApiProperty({ example: 120000.0 })
  @ToNumber()
  montoTotalADevolver: number;

  @ApiProperty({ example: 'Juan Pérez' })
  nombrecliente: string;
}

export class TodayLoansDto {
  @ApiProperty({ example: '2024-11-11' })
  date: string;

  @ApiProperty({ example: 5, type: Number })
  total: number;

  @ApiProperty({ example: 500000.0, type: Number })
  @ToNumber()
  totalAmount: number;

  @ApiProperty({ type: [TodayLoanItemDto] })
  loans: TodayLoanItemDto[];
}
