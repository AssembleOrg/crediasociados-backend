import {
  IsEmail,
  IsString,
  IsOptional,
  MinLength,
  IsEnum,
  IsInt,
  Min,
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
}
