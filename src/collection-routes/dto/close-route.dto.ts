import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseRouteDto {
  @ApiPropertyOptional({
    example: 'Ruta completada exitosamente. Todos los cobros realizados.',
    description: 'Notas opcionales sobre el cierre de la ruta',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

