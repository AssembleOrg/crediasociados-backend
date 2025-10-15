import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsArray,
  IsString,
  IsOptional,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateExpenseDto } from './create-expense.dto';

export class CreateClosureDto {
  @ApiProperty({
    description: 'Fecha del cierre (zona horaria Buenos Aires)',
    example: '2024-01-15',
    type: String,
  })
  @IsNotEmpty()
  @IsDateString()
  closureDate: string;

  @ApiProperty({
    description: 'Total cobrado en el día',
    example: 150000,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  totalCollected: number;

  @ApiProperty({
    description: 'Lista de gastos del día',
    type: [CreateExpenseDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExpenseDto)
  expenses: CreateExpenseDto[];

  @ApiPropertyOptional({
    description: 'Notas adicionales del cierre',
    example: 'Día con buen cobro en zona norte',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
