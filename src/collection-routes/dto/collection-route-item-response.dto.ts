import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CollectionRouteItemResponseDto {
  @ApiProperty({ example: 'cuid_here' })
  id: string;

  @ApiProperty({ example: 'route_id_here' })
  routeId: string;

  @ApiProperty({ example: 'subloan_id_here' })
  subLoanId: string;

  @ApiProperty({ example: 'Juan Pérez' })
  clientName: string;

  @ApiPropertyOptional({ example: '+54 9 11 1234-5678' })
  clientPhone?: string;

  @ApiPropertyOptional({ example: 'Av. Corrientes 1234, CABA' })
  clientAddress?: string;

  @ApiProperty({ example: 0 })
  orderIndex: number;

  @ApiProperty({ example: 5000.0 })
  amountCollected: number;

  @ApiProperty({
    description:
      'Deuda previa del cliente: cuotas impagas (OVERDUE/PARTIAL/PENDING) de préstamos ACTIVE con vencimiento anterior al día de la ruta. Informativo.',
    example: { count: 2, amount: 12000.0 },
  })
  clientPreviousDebt: { count: number; amount: number };

  @ApiPropertyOptional({ example: 'Cliente pagó completo' })
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  subLoan?: any; // SubLoan details if included
}

