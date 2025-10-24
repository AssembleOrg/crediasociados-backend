import { ApiProperty } from '@nestjs/swagger';

export class ManagerDashboardDto {
  @ApiProperty({
    description: 'Capital disponible en la wallet para prestar',
    example: 150000.0,
  })
  capitalDisponible: number;

  @ApiProperty({
    description: 'Total de capital asignado por el SUBADMIN (transferencias recibidas)',
    example: 300000.0,
  })
  capitalAsignado: number;

  @ApiProperty({
    description: 'Total recaudado en el mes actual (subloans pagados)',
    example: 75000.0,
  })
  recaudadoEsteMes: number;

  @ApiProperty({
    description: 'Valor total de la cartera (préstamos activos + wallet)',
    example: 450000.0,
  })
  valorCartera: number;
}

