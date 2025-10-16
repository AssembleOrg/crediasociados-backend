import { ApiProperty } from '@nestjs/swagger';

export class ManagerInactiveClientsDto {
  @ApiProperty({ description: 'ID del manager' })
  managerId: string;

  @ApiProperty({ description: 'Nombre del manager' })
  managerName: string;

  @ApiProperty({ description: 'Email del manager' })
  managerEmail: string;

  @ApiProperty({
    description: 'Cantidad de clientes sin préstamos activos',
  })
  inactiveClientsCount: number;
}

export class InactiveClientsResponseDto {
  @ApiProperty({
    description: 'Total de clientes sin préstamos activos',
  })
  totalInactiveClients: number;

  @ApiProperty({
    type: [ManagerInactiveClientsDto],
    description: 'Detalle por manager',
  })
  managerDetails: ManagerInactiveClientsDto[];
}

