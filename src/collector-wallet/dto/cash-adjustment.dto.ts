import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CashAdjustmentDto {
  @ApiProperty({
    description: 'ID del manager al que se le ajustará la wallet de cobros',
    example: 'cmhzpk1oc0004gx4bqu09kmf6',
  })
  @IsNotEmpty({ message: 'El managerId es requerido' })
  @IsString({ message: 'El managerId debe ser texto' })
  managerId: string;

  @ApiProperty({
    description: 'Monto a ingresar a la wallet de cobros (desde la wallet del subadmin)',
    example: 10000,
    minimum: 0.01,
  })
  @IsNotEmpty({ message: 'El monto es requerido' })
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount: number;

  @ApiProperty({
    description: 'Descripción del ajuste de caja',
    example: 'Ajuste de caja negativo - Cuadre de fin de semana',
  })
  @IsNotEmpty({ message: 'La descripción es requerida' })
  @IsString({ message: 'La descripción debe ser texto' })
  description: string;
}

