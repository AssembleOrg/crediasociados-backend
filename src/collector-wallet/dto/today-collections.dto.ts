import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '../../common/transformers/decimal.transformer';

export class TodayCollectionItemDto {
  @ApiProperty({ example: 50000.0 })
  @ToNumber()
  monto: number;

  @ApiProperty({ example: 'Manager Cobrador' })
  nombreUsuario: string;

  @ApiProperty({ example: 'manager@test.com' })
  emailUsuario: string;

  @ApiProperty({ example: 'Cobro préstamo LOAN-2024-001 - Cuota #1' })
  descripcion: string;

  @ApiProperty({ example: '2024-11-11T10:30:00.000Z' })
  fechaCobro: Date;
}

export class TodayCollectionsDto {
  @ApiProperty({ example: '2024-11-11' })
  date: string;

  @ApiProperty({ example: 10, type: Number })
  total: number;

  @ApiProperty({ example: 500000.0, type: Number })
  @ToNumber()
  totalAmount: number;

  @ApiProperty({ type: [TodayCollectionItemDto] })
  collections: TodayCollectionItemDto[];
}
