import { IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubadminReportDto {
  @ApiProperty({
    description: 'Fecha de inicio del período (formato: YYYY-MM-DD)',
    example: '2025-12-04',
  })
  @IsNotEmpty({ message: 'startDate es requerido' })
  @IsDateString({}, { message: 'startDate debe ser una fecha válida (YYYY-MM-DD)' })
  startDate: string;

  @ApiProperty({
    description: 'Fecha de fin del período (formato: YYYY-MM-DD)',
    example: '2025-12-06',
  })
  @IsNotEmpty({ message: 'endDate es requerido' })
  @IsDateString({}, { message: 'endDate debe ser una fecha válida (YYYY-MM-DD)' })
  endDate: string;
}

