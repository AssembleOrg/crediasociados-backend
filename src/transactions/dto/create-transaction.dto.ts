import {
  IsString,
  IsOptional,
  IsEnum,
  IsPositive,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TransactionType, Currency } from '../../common/enums';

export class CreateTransactionDto {
  @ApiPropertyOptional({ example: 'loan_id_here' })
  @IsOptional()
  @IsString()
  loanId?: string;

  @ApiPropertyOptional({ example: 'client_id_here' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiProperty({ enum: TransactionType, example: TransactionType.INCOME })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ example: 10000.0 })
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ enum: Currency, example: Currency.ARS })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ example: 'Payment received for SubLoan #1' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'subloan_id_here' })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiPropertyOptional({ example: '2024-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
