import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RouteItemOrderDto {
  @ApiProperty({ example: 'item_id_here' })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 0, description: 'Nuevo índice de orden (0-based)' })
  @IsInt()
  @Min(0)
  orderIndex: number;
}

export class UpdateRouteOrderDto {
  @ApiProperty({ type: [RouteItemOrderDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteItemOrderDto)
  items: RouteItemOrderDto[];
}

