import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '../../common/transformers/decimal.transformer';

export class TodayExpenseItemDto {
  @ApiProperty({ example: 5000.0 })
  @ToNumber()
  monto: number;

  @ApiProperty({ example: 'COMBUSTIBLE' })
  categoria: string;

  @ApiProperty({ example: 'Combustible para la ruta - YPF Ruta 3' })
  descripcion: string;

  @ApiProperty({ example: 'Manager Cobrador' })
  nombreManager: string;

  @ApiProperty({ example: 'manager@test.com' })
  emailManager: string;

  @ApiProperty({ example: '2024-11-11T14:30:00.000Z' })
  fechaGasto: Date;
}

export class TodayExpensesDto {
  @ApiProperty({ example: '2024-11-11' })
  date: string;

  @ApiProperty({ example: 5, type: Number })
  total: number;

  @ApiProperty({ example: 25000.0, type: Number })
  @ToNumber()
  totalAmount: number;

  @ApiProperty({ type: [TodayExpenseItemDto] })
  expenses: TodayExpenseItemDto[];
}
