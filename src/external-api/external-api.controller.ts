import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ExternalApiService } from './external-api.service';
import { ExternalApiResponseDto } from './dto/external-api-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';

@ApiTags('External API')
@Controller('external-api')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ExternalApiController {
  constructor(private readonly externalApiService: ExternalApiService) {}

  @Post('dolar-blue/fetch')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Fetch and persist current Dólar Blue data from external API' })
  @ApiResponse({ 
    status: 201, 
    description: 'Dólar Blue data fetched and persisted successfully',
    type: ExternalApiResponseDto
  })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  async fetchDolarBlue(): Promise<ExternalApiResponseDto> {
    return this.externalApiService.fetchAndPersistDolarBlue();
  }

  @Get('dolar-blue/latest')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get the latest successful Dólar Blue data from database' })
  @ApiResponse({ 
    status: 200, 
    description: 'Latest Dólar Blue data retrieved successfully',
    type: ExternalApiResponseDto
  })
  @ApiResponse({ status: 404, description: 'No successful data found' })
  async getLatestDolarBlue(): Promise<ExternalApiResponseDto | null> {
    return this.externalApiService.getLatestDolarBlue();
  }

  @Get('dolar-blue/current-rate')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get current exchange rates for calculations' })
  @ApiResponse({ 
    status: 200, 
    description: 'Current exchange rates retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        compra: { type: 'number', example: 1020.50 },
        venta: { type: 'number', example: 1050.75 }
      }
    }
  })
  async getCurrentExchangeRate(): Promise<{ compra: number; venta: number } | null> {
    return this.externalApiService.getCurrentExchangeRate();
  }

  @Get('responses')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get all external API responses with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  @ApiResponse({ 
    status: 200, 
    description: 'API responses retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ExternalApiResponseDto' } },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
            hasNextPage: { type: 'boolean' },
            hasPreviousPage: { type: 'boolean' }
          }
        }
      }
    }
  })
  async getAllApiResponses(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<ExternalApiResponseDto>> {
    return this.externalApiService.getAllApiResponses(pagination);
  }

  @Get('responses/date-range')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get API responses within a date range' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  async getApiResponsesByDateRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<ExternalApiResponseDto>> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.externalApiService.getApiResponsesByDateRange(start, end, pagination);
  }

  @Get('stats')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get statistics about external API calls' })
  @ApiResponse({ 
    status: 200, 
    description: 'API statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalCalls: { type: 'number', example: 150 },
        successfulCalls: { type: 'number', example: 145 },
        failedCalls: { type: 'number', example: 5 },
        averageResponseTime: { type: 'number', example: 250 },
        lastSuccessfulCall: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00.000Z' }
      }
    }
  })
  async getApiStats(): Promise<{
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageResponseTime: number;
    lastSuccessfulCall?: Date;
  }> {
    return this.externalApiService.getApiResponseStats();
  }
} 