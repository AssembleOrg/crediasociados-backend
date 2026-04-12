import { IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSubLoanDueDateDto {
  @ApiProperty({
    description: 'Nueva fecha de vencimiento (ISO 8601)',
    example: '2025-04-15T00:00:00.000Z',
  })
  @IsDateString()
  dueDate: string;
}

export class UpdateSubLoanPaidDateDto {
  @ApiPropertyOptional({
    description: 'Nueva fecha de pago (ISO 8601). Enviar null para limpiar la fecha.',
    example: '2025-04-10T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  paidDate?: string | null;
}
