import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClientChartDataDto {
  @ApiProperty({ example: 'client_id_here' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  fullName: string;

  @ApiPropertyOptional({ example: '12345678' })
  dni?: string;

  @ApiPropertyOptional({ example: '20-12345678-9' })
  cuit?: string;

  @ApiProperty({ example: 3, type: Number })
  totalLoans: number;

  @ApiProperty({ example: 250000.5, type: Number })
  totalAmount: number;

  @ApiProperty({ example: 1, type: Number })
  activeLoans: number;

  @ApiProperty({ example: 150000.0, type: Number })
  activeAmount: number;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Fecha de creación (zona horaria de Buenos Aires)',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Fecha del último préstamo (zona horaria de Buenos Aires)',
  })
  lastLoanDate?: Date;
}

export class LoanChartDataDto {
  @ApiProperty({ example: 'loan_id_here' })
  id: string;

  @ApiProperty({ example: 'LOAN-2024-001' })
  loanTrack: string;

  @ApiProperty({ example: 100000.5, type: Number })
  amount: number;

  @ApiProperty({ example: 100000.5, type: Number })
  originalAmount: number;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: 'ARS' })
  currency: string;

  @ApiProperty({ example: 'WEEKLY' })
  paymentFrequency: string;

  @ApiProperty({ example: 12, type: Number })
  totalPayments: number;

  @ApiProperty({ example: 8, type: Number })
  completedPayments: number;

  @ApiProperty({ example: 4, type: Number })
  pendingPayments: number;

  @ApiProperty({ example: 75000.0, type: Number })
  paidAmount: number;

  @ApiProperty({ example: 25000.5, type: Number })
  remainingAmount: number;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description:
      'Fecha de creación del préstamo (zona horaria de Buenos Aires)',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-03-15T00:00:00.000Z',
    description: 'Próxima fecha de vencimiento (zona horaria de Buenos Aires)',
  })
  nextDueDate?: Date;

  @ApiProperty({
    type: 'object',
    properties: {
      id: { type: 'string' },
      fullName: { type: 'string' },
      dni: { type: 'string' },
    },
  })
  client: {
    id: string;
    fullName: string;
    dni?: string;
  };
}

export class ChartStatsDto {
  @ApiProperty({ example: 'Total de Clientes' })
  label: string;

  @ApiProperty({ example: 150, type: Number })
  value: number;

  @ApiPropertyOptional({ example: 'ARS' })
  currency?: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  color?: string;
}

export class PeriodStatsDto {
  @ApiProperty({ example: '2024-01' })
  period: string;

  @ApiProperty({ example: 25, type: Number })
  count: number;

  @ApiProperty({ example: 500000.75, type: Number })
  amount: number;

  @ApiProperty({ example: 'ARS' })
  currency: string;
}
