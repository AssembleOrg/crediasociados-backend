import { IsOptional, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CollectorWalletTransactionType } from '../../common/enums';

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
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite debe ser mayor o igual a 1' })
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de transacción',
    enum: CollectorWalletTransactionType,
    example: CollectorWalletTransactionType.COLLECTION,
  })
  @IsOptional()
  @IsEnum(CollectorWalletTransactionType, {
    message: 'El tipo debe ser COLLECTION o WITHDRAWAL',
  })
  type?: CollectorWalletTransactionType;
}

