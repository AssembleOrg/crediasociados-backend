import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRoutesQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'CLOSED'],
    description: 'Filtrar por estado de la ruta',
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'CLOSED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filtrar desde fecha (inclusive)',
    example: '2025-10-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filtrar hasta fecha (inclusive)',
    example: '2025-10-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'ID del manager (solo para SUBADMIN/ADMIN)',
    example: 'manager_id_here',
  })
  @IsOptional()
  managerId?: string;
}

