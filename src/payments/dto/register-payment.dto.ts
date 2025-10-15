import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../common/enums';

export class RegisterPaymentDto {
  @ApiProperty({
    description: 'ID del SubLoan a pagar',
    example: 'cm1234567890',
  })
  @IsNotEmpty()
  @IsString()
  subLoanId: string;

  @ApiProperty({
    description: 'Monto del pago',
    example: 50000,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'Moneda del pago',
    enum: Currency,
    example: Currency.ARS,
  })
  @IsNotEmpty()
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({
    description: 'Fecha del pago (zona horaria Buenos Aires)',
    example: '2024-01-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({
    description: 'Descripción del pago',
    example: 'Pago cuota 1 - Cliente Juan',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
