import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsPositive, IsString, MaxLength, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export enum ExpenseCategoryEnum {
  COMBUSTIBLE = 'COMBUSTIBLE',
  CONSUMO = 'CONSUMO',
  REPARACIONES = 'REPARACIONES',
  OTROS = 'OTROS',
}

export class CreateRouteExpenseDto {
  @ApiProperty({
    enum: ExpenseCategoryEnum,
    example: 'COMBUSTIBLE',
    description: 'Categoría del gasto',
  })
  @IsEnum(ExpenseCategoryEnum)
  category: ExpenseCategoryEnum;

  @ApiProperty({
    example: 5000,
    description: 'Monto del gasto',
  })
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @ApiProperty({
    example: 'Combustible para la ruta - YPF Ruta 3',
    description: 'Descripción del gasto',
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  description: string;
}

export class UpdateRouteExpenseDto {
  @ApiPropertyOptional({
    enum: ExpenseCategoryEnum,
    example: 'COMBUSTIBLE',
    description: 'Categoría del gasto',
  })
  @IsOptional()
  @IsEnum(ExpenseCategoryEnum)
  category?: ExpenseCategoryEnum;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Monto del gasto',
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({
    example: 'Combustible para la ruta - YPF Ruta 3',
    description: 'Descripción del gasto',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class RouteExpenseResponseDto {
  @ApiProperty({ example: 'expense_id_here' })
  id: string;

  @ApiProperty({ example: 'route_id_here' })
  routeId: string;

  @ApiProperty({ enum: ExpenseCategoryEnum, example: 'COMBUSTIBLE' })
  category: string;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ example: 'Combustible para la ruta - YPF Ruta 3' })
  description: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}


