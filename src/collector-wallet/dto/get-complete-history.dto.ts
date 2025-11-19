import { IsOptional, IsInt, Min, IsEnum, IsString, IsDateString, IsNotEmpty, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollectorWalletTransactionType } from '../../common/enums';

export class GetCompleteHistoryDto {
  @ApiProperty({
    description: 'ID del manager del cual se obtendrá el historial',
    example: 'cmhzpk25e0008gx4bllhe9i5t',
  })
  @IsNotEmpty({ message: 'managerId es requerido' })
  @IsString({ message: 'managerId debe ser texto' })
  managerId: string;

  @ApiPropertyOptional({
    description: 'Número de página',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero' })
  @Min(1, { message: 'La página debe ser mayor o igual a 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Cantidad de resultados por página',
    example: 50,
    minimum: 1,
    maximum: 200,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite debe ser mayor o igual a 1' })
  @Max(200, { message: 'El límite no puede ser mayor a 200' })
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de transacción',
    enum: CollectorWalletTransactionType,
    example: CollectorWalletTransactionType.COLLECTION,
  })
  @IsOptional()
  @IsEnum(CollectorWalletTransactionType, {
    message: 'El tipo de transacción no es válido',
  })
  type?: CollectorWalletTransactionType;

  @ApiPropertyOptional({
    description: 'Fecha desde (YYYY-MM-DD). Se interpreta como el inicio del día en zona horaria de Buenos Aires.',
    example: '2025-11-10',
  })
  @IsOptional()
  @IsString()
  @IsDateString({}, { message: 'startDate debe ser una fecha válida en formato YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha hasta (YYYY-MM-DD). Se interpreta como el final del día en zona horaria de Buenos Aires.',
    example: '2025-11-17',
  })
  @IsOptional()
  @IsString()
  @IsDateString({}, { message: 'endDate debe ser una fecha válida en formato YYYY-MM-DD' })
  endDate?: string;
}

