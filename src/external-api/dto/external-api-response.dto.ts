import { ApiProperty } from '@nestjs/swagger';

export class ExternalApiResponseDto {
  @ApiProperty({ example: 'cuid123', description: 'Unique identifier' })
  id: string;

  @ApiProperty({ example: 1020.5, description: 'Buy price' })
  compra: number;

  @ApiProperty({ example: 1050.75, description: 'Sell price' })
  venta: number;

  @ApiProperty({ example: 'blue', description: 'Exchange house type' })
  casa: string;

  @ApiProperty({ example: 'Dólar Blue', description: 'Currency name' })
  nombre: string;

  @ApiProperty({ example: 'USD', description: 'Currency code' })
  moneda: string;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Last update from external API',
  })
  fechaActualizacion: string;

  @ApiProperty({
    example: 'https://dolarapi.com/v1/dolares/blue',
    description: 'API URL called',
  })
  apiUrl: string;

  @ApiProperty({
    example: 'SUCCESS',
    description: 'Call status',
    enum: ['SUCCESS', 'ERROR', 'TIMEOUT'],
  })
  status: string;

  @ApiProperty({
    example: 250,
    description: 'Response time in milliseconds',
    required: false,
  })
  responseTime?: number;

  @ApiProperty({
    example: '2024-01-15T10:35:00.000Z',
    description: 'When the record was created in our system',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-15T10:35:00.000Z',
    description: 'When the record was last updated',
  })
  updatedAt: Date;
}
