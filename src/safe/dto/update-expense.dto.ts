import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateExpenseDto {
  @ApiPropertyOptional({ example: 'Combustible', description: 'Nombre del gasto' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Gasto actualizado en combustible', description: 'Descripción del gasto' })
  @IsOptional()
  @IsString()
  description?: string;
}

