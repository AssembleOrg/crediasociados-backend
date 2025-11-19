import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActiveLoanItemDto {
  @ApiProperty({ example: 'loan_id_here' })
  id: string;

  @ApiProperty({ example: 'CREDITO-2025-00024' })
  loanTrack: string;

  @ApiProperty({ example: 60000.0 })
  amount: number;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: '2025-11-01T00:00:00.000Z' })
  createdAt: Date;
}

export class ActiveLoansClientItemDto {
  @ApiProperty({ example: 'client_id_here' })
  id: string;

  @ApiProperty({ example: 'Juan Pérez' })
  nombre: string;

  @ApiPropertyOptional({ example: '+5491123456789' })
  telefono?: string;

  @ApiPropertyOptional({ example: 'Av. Corrientes 1234, Buenos Aires' })
  direccion?: string;

  @ApiProperty({ example: 2, type: Number })
  cantidadPrestamosActivos: number;

  @ApiProperty({ type: [ActiveLoanItemDto] })
  prestamosActivos: ActiveLoanItemDto[];
}

export class ActiveLoansClientsDto {
  @ApiProperty({ example: 15, type: Number })
  total: number;

  @ApiProperty({ type: [ActiveLoansClientItemDto] })
  clients: ActiveLoansClientItemDto[];
}


