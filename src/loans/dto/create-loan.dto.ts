import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsPositive,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LoanStatus,
  Currency,
  PaymentFrequency,
  PaymentDay,
} from '../../common/enums';
import { Type } from 'class-transformer';

export class CreateLoanDto {
  @ApiProperty({ example: 'client_id_here' })
  @IsString()
  clientId: string;

  @ApiProperty({ example: 100000.0 })
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 0.05 })
  @Type(() => Number)
  @IsPositive()
  baseInterestRate: number;

  @ApiProperty({ example: 0.05 })
  @Type(() => Number)
  @IsPositive()
  penaltyInterestRate: number;

  @ApiPropertyOptional({ enum: Currency, example: Currency.ARS })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ enum: PaymentFrequency, example: PaymentFrequency.WEEKLY })
  @IsEnum(PaymentFrequency)
  paymentFrequency: PaymentFrequency;

  @ApiPropertyOptional({ enum: PaymentDay, example: PaymentDay.FRIDAY })
  @IsOptional()
  @IsEnum(PaymentDay)
  paymentDay?: PaymentDay;

  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  totalPayments: number;

  @ApiPropertyOptional({ example: '2024-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  firstDueDate?: string;

  @ApiPropertyOptional({
    example: 'LOAN-2024-001',
    description:
      'Unique tracking code for the loan (auto-generated if not provided)',
  })
  @IsOptional()
  @IsString()
  loanTrack?: string;

  @ApiPropertyOptional({ example: 'Personal loan for business expansion' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'Client requested weekly payments on Fridays',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
