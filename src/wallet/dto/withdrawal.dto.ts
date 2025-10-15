import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../common/enums';

export class WithdrawalDto {
  @ApiProperty({
    description: 'Monto a retirar',
    example: 10000,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'Moneda',
    enum: Currency,
    example: Currency.ARS,
  })
  @IsNotEmpty()
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({
    description: 'Descripción del retiro',
    example: 'Retiro para gastos personales',
  })
  @IsNotEmpty()
  @IsString()
  description: string;
}
