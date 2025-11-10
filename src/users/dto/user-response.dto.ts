import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, Currency } from 'src/common/enums';

export class WalletInfoDto {
  @ApiProperty({ description: 'ID de la cartera' })
  id: string;

  @ApiProperty({ description: 'Saldo disponible', example: 1234.56 })
  balance: number;

  @ApiProperty({ enum: Currency, description: 'Moneda de la cartera' })
  currency: Currency;
}

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ required: false, nullable: true })
  phone?: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ required: false, nullable: true })
  dni?: string | null;

  @ApiProperty({ required: false, nullable: true })
  cuit?: string | null;

  @ApiProperty({ description: 'Cuota total de clientes asignada' })
  clientQuota: number;

  @ApiProperty({ description: 'Cuota de clientes ya utilizada' })
  usedClientQuota: number;

  @ApiProperty({ description: 'Cuota de clientes disponible' })
  availableClientQuota: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Porcentaje de comisión del manager (solo MANAGER)',
    example: 10.5,
  })
  commission?: number | null;

  @ApiPropertyOptional({
    type: WalletInfoDto,
    nullable: true,
    description: 'Información de la cartera del usuario (solo SUBADMIN y MANAGER)',
  })
  wallet?: WalletInfoDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
