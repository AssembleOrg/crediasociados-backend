import { IsString, IsOptional, IsEnum, IsInt, IsPositive, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanStatus, Currency, PaymentFrequency, PaymentDay } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateLoanDto {
  @ApiProperty({ example: 'client_id_here' })
  @IsString()
  clientId: string;

  @ApiProperty({ example: 100000.00 })
  @Type(() => Number)
  @IsPositive()
  amount: number;

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

  @ApiProperty({ example: 15.0, description: 'Base interest rate percentage' })
  @Type(() => Number)
  @IsPositive()
  baseInterestRate: number;

  @ApiProperty({ example: 35.0, description: 'Penalty interest rate for overdue payments' })
  @Type(() => Number)
  @IsPositive()
  penaltyInterestRate: number;

  @ApiPropertyOptional({ example: 'Personal loan for business expansion' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Client requested weekly payments on Fridays' })
  @IsOptional()
  @IsString()
  notes?: string;
} 