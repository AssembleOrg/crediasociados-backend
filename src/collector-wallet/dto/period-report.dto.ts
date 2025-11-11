import { IsOptional, IsDateString, IsString } from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'ID del manager del cual obtener el reporte. Solo disponible para ADMIN y SUBADMIN. ' +
      'Si no se proporciona, usa el usuario autenticado (su propio reporte).',
    example: 'cmht5jiq20008gxv2ndk6mj8i',
  })
  @IsOptional()
  @IsString({ message: 'managerId debe ser un string válido' })
  managerId?: string;
}

