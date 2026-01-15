import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  UserRole,
  LoanStatus,
  PaymentFrequency,
  Currency,
} from '@prisma/client';

export class ClientFiltersDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  dni?: string;

  @ApiPropertyOptional({ example: '20-12345678-9' })
  @IsOptional()
  @IsString()
  cuit?: string;

  @ApiPropertyOptional({ example: 'client@example.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Empleado' })
  @IsOptional()
  @IsString()
  job?: string;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00.000Z',
    description:
      'Fecha de creación desde (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2024-12-31T23:59:59.000Z',
    description:
      'Fecha de creación hasta (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}

export class LoanFiltersDto {
  @ApiPropertyOptional({ example: 'client_id_here' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ example: 'manager_id_here' })
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiPropertyOptional({ example: 'LOAN-2024-001' })
  @IsOptional()
  @IsString()
  loanTrack?: string;

  @ApiPropertyOptional({ enum: LoanStatus, example: LoanStatus.ACTIVE })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @ApiPropertyOptional({ enum: Currency, example: Currency.ARS })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({
    enum: PaymentFrequency,
    example: PaymentFrequency.WEEKLY,
  })
  @IsOptional()
  @IsEnum(PaymentFrequency)
  paymentFrequency?: PaymentFrequency;

  @ApiPropertyOptional({ example: 10000, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  minAmount?: number;

  @ApiPropertyOptional({ example: 100000, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  maxAmount?: number;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00.000Z',
    description:
      'Fecha de creación desde (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2024-12-31T23:59:59.000Z',
    description:
      'Fecha de creación hasta (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00.000Z',
    description:
      'Fecha de vencimiento desde (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional({
    example: '2024-12-31T23:59:59.000Z',
    description:
      'Fecha de vencimiento hasta (ISO 8601 - se interpreta en zona horaria de Buenos Aires)',
  })
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description: 'Búsqueda parcial por nombre de cliente (mínimo 2 caracteres, case-insensitive)',
  })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'COMPLETED', 'ALL'],
    example: 'ACTIVE',
    description: 'Filtro por estado del préstamo. ACTIVE incluye ACTIVE y APPROVED, COMPLETED solo completados, ALL todos',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'COMPLETED', 'ALL'])
  loanStatus?: 'ACTIVE' | 'COMPLETED' | 'ALL';
}
