import { IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RegisterPaymentDto } from './register-payment.dto';

export class BulkPaymentDto {
  @ApiProperty({
    description: 'Lista de pagos a registrar',
    type: [RegisterPaymentDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterPaymentDto)
  payments: RegisterPaymentDto[];
}
