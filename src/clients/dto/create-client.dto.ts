import { IsString, IsOptional, IsEmail, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty({ example: 'John Doe Client' })
  @IsString()
  fullName: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  dni?: string;

  @ApiPropertyOptional({ example: '20-12345678-9' })
  @IsOptional()
  @IsString()
  cuit?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'client@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '123 Main St, City' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Empleado' })
  @IsOptional()
  @IsString()
  job?: string;
}
