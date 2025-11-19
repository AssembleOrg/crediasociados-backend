import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CollectionsSummaryDto {
  @ApiProperty({
    description: 'ID del manager del cual se obtendrá el resumen de cobros',
    example: 'cmhzpk25e0008gx4bllhe9i5t',
  })
  @IsNotEmpty({ message: 'managerId es requerido' })
  @IsString({ message: 'managerId debe ser texto' })
  managerId: string;

  @ApiProperty({
    description: 'Fecha de inicio en formato DD/MM/YYYY. Se interpreta como el inicio del día (00:00) en zona horaria de Buenos Aires.',
    example: '19/11/2025',
  })
  @IsNotEmpty({ message: 'startDate es requerido' })
  @IsString({ message: 'startDate debe ser texto' })
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'startDate debe tener el formato DD/MM/YYYY (ej: 19/11/2025)',
  })
  startDate: string;

  @ApiProperty({
    description: 'Fecha de fin en formato DD/MM/YYYY. Se interpreta como el final del día (23:59) en zona horaria de Buenos Aires.',
    example: '25/11/2025',
  })
  @IsNotEmpty({ message: 'endDate es requerido' })
  @IsString({ message: 'endDate debe ser texto' })
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'endDate debe tener el formato DD/MM/YYYY (ej: 25/11/2025)',
  })
  endDate: string;
}

