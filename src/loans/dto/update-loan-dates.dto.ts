import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateLoanFirstDueDateDto {
  @ApiProperty({
    description: 'Nueva fecha del primer vencimiento (ISO 8601)',
    example: '2025-04-15T00:00:00.000Z',
  })
  @IsDateString()
  firstDueDate: string;
}
