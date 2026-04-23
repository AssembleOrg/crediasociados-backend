import {
  IsOptional,
  IsEnum,
  IsInt,
  IsPositive,
  IsDateString,
  Min,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentFrequency, PaymentDay } from '../../common/enums';
import { Type } from 'class-transformer';

export class RenewLoanDto {
  @ApiProperty({ example: 100000.0, description: 'Capital del nuevo préstamo (default: capital original del préstamo renovado)' })
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 0.5 })
  @Type(() => Number)
  @Min(0)
  baseInterestRate: number;

  @ApiProperty({ example: 0.05 })
  @Type(() => Number)
  @Min(0)
  penaltyInterestRate: number;

  @ApiProperty({ enum: PaymentFrequency, example: PaymentFrequency.DAILY })
  @IsEnum(PaymentFrequency)
  paymentFrequency: PaymentFrequency;

  @ApiPropertyOptional({ enum: PaymentDay, example: PaymentDay.FRIDAY })
  @IsOptional()
  @IsEnum(PaymentDay)
  paymentDay?: PaymentDay;

  @ApiProperty({ example: 24 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  totalPayments: number;

  @ApiProperty({ example: '2026-05-01', description: 'Fecha del primer vencimiento del nuevo préstamo' })
  @IsDateString()
  firstDueDate: string;

  @ApiPropertyOptional({ example: 'Renovación de préstamo' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Notas internas' })
  @IsOptional()
  @IsString()
  notes?: string;
}
