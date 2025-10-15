import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../common/enums';

export class TransferDto {
  @ApiProperty({
    description: 'ID del manager destinatario',
    example: 'cm1234567890',
  })
  @IsNotEmpty()
  @IsString()
  managerId: string;

  @ApiProperty({
    description: 'Monto a transferir',
    example: 100000,
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
    description: 'Descripción de la transferencia',
    example: 'Transferencia de capital de trabajo',
  })
  @IsNotEmpty()
  @IsString()
  description: string;
}
