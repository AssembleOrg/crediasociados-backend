import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClientLossDto {
  @ApiPropertyOptional({
    description: 'Notas del cobrador sobre el motivo de la pérdida',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
