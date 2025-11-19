import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManagerDetailDto {
  @ApiProperty({
    description: 'ID del manager del cual se obtendrá la información detallada',
    example: 'cmhzpk25e0008gx4bllhe9i5t',
  })
  @IsNotEmpty({ message: 'managerId es requerido' })
  @IsString({ message: 'managerId debe ser texto' })
  managerId: string;
}

