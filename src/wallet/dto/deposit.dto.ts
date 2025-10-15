import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../common/enums';

export class DepositDto {
  @ApiProperty({
    description: 'Monto a depositar',
    example: 50000,
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
    description: 'Descripción del depósito',
    example: 'Depósito inicial',
  })
  @IsNotEmpty()
  @IsString()
  description: string;
}
