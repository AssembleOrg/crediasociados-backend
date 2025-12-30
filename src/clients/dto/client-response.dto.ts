import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClientResponseDto {
  @ApiProperty({ example: 'cuid123' })
  id: string;

  @ApiProperty({ example: 'John Doe Client' })
  fullName: string;

  @ApiPropertyOptional({ example: '12345678' })
  dni?: string;

  @ApiPropertyOptional({ example: '20-12345678-9' })
  cuit?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  phone?: string;

  @ApiPropertyOptional({ example: 'client@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '123 Main St, City' })
  address?: string;

  @ApiPropertyOptional({ example: 'Empleado' })
  job?: string;

  @ApiPropertyOptional({ 
    example: 'Cliente con buena historia crediticia',
    description: 'Descripción adicional del cliente'
  })
  description?: string;

  @ApiPropertyOptional({ example: 'Desarrollador de Software' })
  work?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;
}

export class ClientWithManagersDto extends ClientResponseDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  managers: Array<{
    id: string;
    user: {
      id: string;
      fullName: string;
      email: string;
      role: string;
    };
  }>;
}

export class ClientWithDetailsDto extends ClientWithManagersDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        amount: { type: 'number' },
        status: { type: 'string' },
        loanTrack: { type: 'string' },
        createdAt: { type: 'string' },
        _count: {
          type: 'object',
          properties: {
            subLoans: { type: 'number' },
          },
        },
      },
    },
  })
  loans: Array<{
    id: string;
    amount: number;
    status: string;
    loanTrack: string;
    createdAt: Date;
    _count: {
      subLoans: number;
    };
  }>;

  @ApiProperty({
    type: 'object',
    properties: {
      loans: { type: 'number' },
      transactions: { type: 'number' },
    },
  })
  _count: {
    loans: number;
    transactions: number;
  };
}
