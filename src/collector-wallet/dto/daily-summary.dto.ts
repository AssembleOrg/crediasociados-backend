import { IsOptional, IsDateString, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DailySummaryDto {
  @ApiPropertyOptional({
    description:
      'Fecha del día a consultar (formato: YYYY-MM-DD). Si no se proporciona, usa el día actual.',
    example: '2025-11-02',
  })
  @IsOptional()
  @IsDateString({}, { message: 'date debe ser una fecha válida (YYYY-MM-DD)' })
  date?: string;

  @ApiPropertyOptional({
    description:
      'ID del manager a consultar (solo para SUBADMIN). Si no se proporciona, usa el usuario autenticado.',
    example: 'clxxx...',
  })
  @IsOptional()
  @IsString({ message: 'managerId debe ser un string' })
  managerId?: string;
}

