import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '../../common/enums';

export class CreateExpenseDto {
  @ApiProperty({
    description: 'Categoría del gasto',
    enum: ExpenseCategory,
    example: ExpenseCategory.COMBUSTIBLE,
  })
  @IsNotEmpty()
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @ApiProperty({
    description: 'Monto del gasto',
    example: 5000,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    description: 'Descripción del gasto',
    example: 'Nafta para recorrido zona norte',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
