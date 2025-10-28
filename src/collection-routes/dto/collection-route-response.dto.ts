import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollectionRouteItemResponseDto } from './collection-route-item-response.dto';
import { RouteExpenseResponseDto } from './route-expense.dto';

export class CollectionRouteResponseDto {
  @ApiProperty({ example: 'cuid_here' })
  id: string;

  @ApiProperty({ example: 'manager_id_here' })
  managerId: string;

  @ApiProperty()
  routeDate: Date;

  @ApiProperty({ enum: ['ACTIVE', 'CLOSED'], example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: 50000.0 })
  totalCollected: number;

  @ApiProperty({ example: 5000.0 })
  totalExpenses: number;

  @ApiProperty({ example: 45000.0 })
  netAmount: number;

  @ApiPropertyOptional({ example: 'Ruta completada sin inconvenientes' })
  notes?: string;

  @ApiPropertyOptional()
  closedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [CollectionRouteItemResponseDto] })
  items: CollectionRouteItemResponseDto[];

  @ApiProperty({ type: [RouteExpenseResponseDto] })
  expenses: RouteExpenseResponseDto[];

  @ApiPropertyOptional()
  manager?: any; // Manager details if included
}

