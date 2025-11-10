import {
  IsEmail,
  IsString,
  IsOptional,
  MinLength,
  IsEnum,
  IsInt,
  Min,
  IsNumber,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from 'src/common/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  fullName: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    example: 100,
    description:
      'Cuota de clientes asignada al usuario. Requerido para SUBADMIN y MANAGER.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  clientQuota?: number;

  @ApiPropertyOptional({
    example: 10.5,
    description:
      'Porcentaje de comisión asignado al manager (0-100). Solo aplica para MANAGER.',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commission?: number;
}
