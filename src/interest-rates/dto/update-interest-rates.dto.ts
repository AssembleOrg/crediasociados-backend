import { IsArray, IsInt, IsPositive, ValidateNested, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class InterestRateRuleDto {
  @ApiProperty({ example: 10, description: 'Days overdue threshold' })
  @IsInt()
  @Min(0)
  daysOverdue: number;

  @ApiProperty({ example: 15.0, description: 'Interest rate percentage' })
  @IsPositive()
  @Min(0)
  @Max(100)
  interestRate: number;
}

export class UpdateInterestRatesDto {
  @ApiProperty({
    type: [InterestRateRuleDto],
    example: [
      { daysOverdue: 10, interestRate: 15.0 },
      { daysOverdue: 15, interestRate: 20.0 },
      { daysOverdue: 20, interestRate: 25.0 },
      { daysOverdue: 26, interestRate: 30.0 },
      { daysOverdue: 27, interestRate: 35.0 },
      { daysOverdue: 30, interestRate: 41.0 }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestRateRuleDto)
  rates: InterestRateRuleDto[];
} 