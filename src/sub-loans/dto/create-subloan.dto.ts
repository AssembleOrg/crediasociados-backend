import { IsString, IsOptional, IsEnum, IsInt, IsPositive, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubLoanStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateSubLoanDto {
  @ApiProperty({ example: 'loan_id_here' })
  @IsString()
  loanId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  paymentNumber: number;

  @ApiProperty({ example: 8333.33 })
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 8333.33 })
  @Type(() => Number)
  @IsPositive()
  totalAmount: number;

  @ApiProperty({ example: '2024-12-31T23:59:59.000Z' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ enum: SubLoanStatus, example: SubLoanStatus.PENDING })
  @IsOptional()
  @IsEnum(SubLoanStatus)
  status?: SubLoanStatus;
} 