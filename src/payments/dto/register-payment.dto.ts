import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsString,
  IsOptional,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../common/enums';

export class RegisterPaymentDto {
  @ApiProperty({
    description: 'ID del SubLoan a pagar',
    example: 'cm1234567890',
  })
  @IsNotEmpty()
  @IsString()
  subLoanId: string;

  @ApiProperty({
    description: 'Monto del pago',
    example: 50000,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'Moneda del pago',
    enum: Currency,
    example: Currency.ARS,
  })
  @IsNotEmpty()
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({
    description: 'Fecha del pago (zona horaria Buenos Aires)',
    example: '2024-01-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({
    description: 'Descripción del pago',
    example: 'Pago cuota 1 - Cliente Juan',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Nuevo monto total de la cuota (reemplaza totalAmount). ' +
      'Se usa para ajustar el interés: si la cuota era 20k y se quiere cobrar 15k, enviar 15000. ' +
      'Se guarda el valor original en originalTotalAmount para poder restaurar en reset.',
    example: 15000,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  adjustedTotalAmount?: number;

  @ApiPropertyOptional({
    description:
      'Si es true (default), el excedente del pago se distribuye automáticamente: ' +
      'primero a cuotas anteriores no pagadas (OVERDUE/PENDING/PARTIAL) y luego a cuotas siguientes. ' +
      'Si es false, no se distribuye: el backend rechaza el pago si el monto excede el saldo pendiente de la cuota.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  distributeOverflow?: boolean;

  @ApiPropertyOptional({
    description:
      'Si es true, "termina" el préstamo: el monto ingresado se cobra y distribuye normalmente, ' +
      'y luego TODAS las cuotas restantes no pagadas se marcan como PAID condonando la diferencia. ' +
      'La diferencia condonada se acumula en Loan.forgivenAmount y el préstamo queda COMPLETED. ' +
      'Funciona tanto si el monto es menor como mayor al total adeudado. Fuerza la distribución del excedente.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  finishLoan?: boolean;
}
