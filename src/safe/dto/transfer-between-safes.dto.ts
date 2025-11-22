import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TransferBetweenSafesDto {
  @ApiProperty({ example: 'manager_id_here', description: 'ID del manager destinatario (caja fuerte destino)' })
  @IsString()
  targetManagerId: string;

  @ApiProperty({ example: 50000.0, description: 'Monto a transferir' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Transferencia entre cajas fuertes' })
  @IsOptional()
  @IsString()
  description?: string;
}

