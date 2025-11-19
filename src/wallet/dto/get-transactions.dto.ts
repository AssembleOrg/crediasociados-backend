import { IsOptional, IsInt, Min, Max, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WalletTransactionType } from '../../common/enums';

export class GetTransactionsDto {
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
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite debe ser mayor o igual a 1' })
  @Max(100, { message: 'El límite no puede ser mayor a 100' })
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de transacción',
    enum: WalletTransactionType,
    example: WalletTransactionType.DEPOSIT,
  })
  @IsOptional()
  @IsEnum(WalletTransactionType, {
    message: 'El tipo debe ser un tipo de transacción válido',
  })
  type?: WalletTransactionType;

  @ApiPropertyOptional({
    description: 'Fecha desde (YYYY-MM-DD). Se usa el inicio del día en zona horaria de Buenos Aires (GMT-3)',
    example: '2025-11-10',
    type: String,
  })
  @IsOptional()
  @IsDateString({}, { message: 'startDate debe ser una fecha válida en formato YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha hasta (YYYY-MM-DD). Se usa el final del día en zona horaria de Buenos Aires (GMT-3)',
    example: '2025-11-17',
    type: String,
  })
  @IsOptional()
  @IsDateString({}, { message: 'endDate debe ser una fecha válida en formato YYYY-MM-DD' })
  endDate?: string;
}

