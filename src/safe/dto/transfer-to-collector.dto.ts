import { IsNumber, IsString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TransferToCollectorDto {
  @ApiProperty({ example: 100000.0, description: 'Monto a transferir a la wallet de cobros' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Transferencia para operaciones de cobro' })
  @IsOptional()
  @IsString()
  description?: string;
}

