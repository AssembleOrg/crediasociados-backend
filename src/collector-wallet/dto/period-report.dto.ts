import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PeriodReportDto {
  @ApiPropertyOptional({
    description:
      'Fecha de inicio del período (formato: YYYY-MM-DD). Si no se proporciona, usa el inicio de la semana actual.',
    example: '2025-11-10',
  })
  @IsOptional()
  @IsDateString({}, { message: 'startDate debe ser una fecha válida (YYYY-MM-DD)' })
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de fin del período (formato: YYYY-MM-DD). Si no se proporciona, usa el fin de la semana actual.',
    example: '2025-11-16',
  })
  @IsOptional()
  @IsDateString({}, { message: 'endDate debe ser una fecha válida (YYYY-MM-DD)' })
  endDate?: string;
}

