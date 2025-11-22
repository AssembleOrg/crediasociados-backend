import { IsOptional, IsEnum, IsDateString, IsInt, Min, Max, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum SafeTransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  EXPENSE = 'EXPENSE',
  TRANSFER_TO_COLLECTOR = 'TRANSFER_TO_COLLECTOR',
  TRANSFER_FROM_COLLECTOR = 'TRANSFER_FROM_COLLECTOR',
  TRANSFER_TO_SAFE = 'TRANSFER_TO_SAFE',
  TRANSFER_FROM_SAFE = 'TRANSFER_FROM_SAFE',
}

export class GetHistoryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50, maximum: 200 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ example: '2025-01-01', description: 'Fecha de inicio (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31', description: 'Fecha de fin (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: SafeTransactionType, description: 'Filtrar por tipo de transacción' })
  @IsOptional()
  @IsEnum(SafeTransactionType)
  type?: SafeTransactionType;

  @ApiPropertyOptional({ example: 'cmhzf5hg3000zgxbxxh445qzl', description: 'ID del manager para consultar su caja fuerte' })
  @IsOptional()
  @IsString()
  managerId?: string;
}

