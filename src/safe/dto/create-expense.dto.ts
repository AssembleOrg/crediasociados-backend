import { IsNumber, IsString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  @ApiProperty({ example: 'Combustible', description: 'Nombre del gasto (case-insensitive para matching)' })
  @IsString()
  name: string;

  @ApiProperty({ example: 15000.0, description: 'Monto del gasto' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Gasto en combustible para la ruta' })
  @IsOptional()
  @IsString()
  description?: string;
}

