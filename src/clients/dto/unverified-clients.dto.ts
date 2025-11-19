import { ApiProperty } from '@nestjs/swagger';

export class UnverifiedClientItemDto {
  @ApiProperty({ example: 'client_id_here' })
  id: string;

  @ApiProperty({ example: 'Juan Pérez' })
  nombre: string;

  @ApiProperty({ example: '+5491112345678', nullable: true })
  telefono?: string;

  @ApiProperty({ example: 'Av. Siempreviva 742', nullable: true })
  direccion?: string;
}

export class UnverifiedClientsDto {
  @ApiProperty({ example: 5, type: Number })
  total: number;

  @ApiProperty({ type: [UnverifiedClientItemDto] })
  clients: UnverifiedClientItemDto[];
}


