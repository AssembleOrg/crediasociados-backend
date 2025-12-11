import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLoanDescriptionDto {
  @ApiPropertyOptional({ description: 'Descripción/notas del préstamo' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
