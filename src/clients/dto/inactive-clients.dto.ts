import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InactiveClientItemDto {
  @ApiProperty({ example: 'client_id_here' })
  id: string;

  @ApiProperty({ example: 'Juan Pérez' })
  nombre: string;

  @ApiPropertyOptional({ example: '+5491123456789' })
  telefono?: string;

  @ApiPropertyOptional({ example: 'Av. Corrientes 1234, Buenos Aires' })
  direccion?: string;

  @ApiPropertyOptional({ example: '2024-10-15T00:00:00.000Z' })
  fechaUltimoPrestamo?: Date;
}

export class InactiveClientsDto {
  @ApiProperty({ example: 10, type: Number })
  total: number;

  @ApiProperty({ type: [InactiveClientItemDto] })
  clients: InactiveClientItemDto[];
}
