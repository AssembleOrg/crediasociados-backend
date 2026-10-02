import { OmitType } from '@nestjs/swagger';
import { RegisterPaymentDto } from './register-payment.dto';

/**
 * Body de PUT /payments/subloan/:subLoanId/edit.
 * Debe ser una clase (no un tipo TS) para que el ValidationPipe global
 * aplique @IsNumber/@IsPositive sobre amount y rechace campos extra.
 */
export class EditPaymentDto extends OmitType(RegisterPaymentDto, [
  'subLoanId',
] as const) {}
