import { IsNumber, IsString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class WithdrawDto {
  @ApiProperty({ example: 50000.0, description: 'Monto a retirar' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Retiro para gastos operativos' })
  @IsOptional()
  @IsString()
  description?: string;
}

