import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DolarApiResponse,
  ApiCallResult,
} from './interfaces/dolar-api.interface';
import { ExternalApiResponseDto } from './dto/external-api-response.dto';
import {
  PaginatedResponse,
  PaginationMeta,
} from '../common/interfaces/pagination.interface';
import { PaginationDto } from '../common/dto/pagination.dto';
import axios, { AxiosResponse } from 'axios';

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);
  private readonly DOLAR_API_URL = 'https://dolarapi.com/v1/dolares/blue';

  constructor(private prisma: PrismaService) {}

  async fetchAndPersistDolarBlue(): Promise<ExternalApiResponseDto> {
    const startTime = Date.now();
    let apiCallResult: ApiCallResult;

    try {
      this.logger.log('Fetching Dólar Blue data from external API...');

      const response: AxiosResponse<DolarApiResponse> = await axios.get(
        this.DOLAR_API_URL,
        {
          timeout: 10000, // 10 seconds timeout
          headers: {
            'User-Agent': 'CrediAsociados-Backend/1.0.0',
            Accept: 'application/json',
          },
        },
      );

      const responseTime = Date.now() - startTime;

      apiCallResult = {
        success: true,
        data: response.data,
        responseTime,
      };

      this.logger.log(`API call successful in ${responseTime}ms`);
    } catch (error) {
      const responseTime = Date.now() - startTime;

      apiCallResult = {
        success: false,
        error: error.message || 'Unknown error',
        responseTime,
      };

      this.logger.error(
        `API call failed after ${responseTime}ms: ${error.message}`,
      );
    }

    // Persist the result to database
    const persistedRecord = await this.persistApiResponse(apiCallResult);

    return this.mapToDto(persistedRecord);
  }

  private async persistApiResponse(result: ApiCallResult) {
    const data = {
      apiUrl: this.DOLAR_API_URL,
      status: result.success ? 'SUCCESS' : 'ERROR',
      responseTime: result.responseTime,
    };

    if (result.success && result.data) {
      // Successful response - save the actual data
      return this.prisma.externalApiResponse.create({
        data: {
          ...data,
          compra: result.data.compra,
          venta: result.data.venta,
          casa: result.data.casa,
          nombre: result.data.nombre,
          moneda: result.data.moneda,
          fechaActualizacion: result.data.fechaActualizacion,
        },
      });
    } else {
      // Error response - save with default/null values
      return this.prisma.externalApiResponse.create({
        data: {
          ...data,
          compra: 0,
          venta: 0,
          casa: 'error',
          nombre: 'Error',
          moneda: 'USD',
          fechaActualizacion: new Date().toISOString(),
        },
      });
    }
  }

  async getLatestDolarBlue(): Promise<ExternalApiResponseDto | null> {
    const latestRecord = await this.prisma.externalApiResponse.findFirst({
      where: {
        apiUrl: this.DOLAR_API_URL,
        status: 'SUCCESS',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return latestRecord ? this.mapToDto(latestRecord) : null;
  }

  async getAllApiResponses(
    pagination: PaginationDto,
  ): Promise<PaginatedResponse<ExternalApiResponseDto>> {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.externalApiResponse.findMany({
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.externalApiResponse.count(),
    ]);

    const data = records.map((record) => this.mapToDto(record));

    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };

    return { data, meta };
  }

  async getApiResponsesByDateRange(
    startDate: Date,
    endDate: Date,
    pagination: PaginationDto,
  ): Promise<PaginatedResponse<ExternalApiResponseDto>> {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.externalApiResponse.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.externalApiResponse.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
    ]);

    const data = records.map((record) => this.mapToDto(record));

    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };

    return { data, meta };
  }

  async getApiResponseStats(): Promise<{
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageResponseTime: number;
    lastSuccessfulCall?: Date;
  }> {
    const [
      totalCalls,
      successfulCalls,
      failedCalls,
      avgResponseTime,
      lastSuccessful,
    ] = await Promise.all([
      this.prisma.externalApiResponse.count(),
      this.prisma.externalApiResponse.count({ where: { status: 'SUCCESS' } }),
      this.prisma.externalApiResponse.count({ where: { status: 'ERROR' } }),
      this.prisma.externalApiResponse.aggregate({
        _avg: { responseTime: true },
        where: { responseTime: { not: null } },
      }),
      this.prisma.externalApiResponse.findFirst({
        where: { status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      averageResponseTime: Math.round(avgResponseTime._avg.responseTime || 0),
      lastSuccessfulCall: lastSuccessful?.createdAt,
    };
  }

  private mapToDto(record: any): ExternalApiResponseDto {
    return {
      id: record.id,
      compra: Number(record.compra),
      venta: Number(record.venta),
      casa: record.casa,
      nombre: record.nombre,
      moneda: record.moneda,
      fechaActualizacion: record.fechaActualizacion,
      apiUrl: record.apiUrl,
      status: record.status,
      responseTime: record.responseTime,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // Method to manually trigger a fetch (useful for testing or manual updates)
  async manualFetch(): Promise<ExternalApiResponseDto> {
    this.logger.log('Manual fetch triggered');
    return this.fetchAndPersistDolarBlue();
  }

  // Method to get the current exchange rate for calculations
  async getCurrentExchangeRate(): Promise<{
    compra: number;
    venta: number;
  } | null> {
    const latest = await this.getLatestDolarBlue();

    if (!latest || latest.status !== 'SUCCESS') {
      this.logger.warn(
        'No successful exchange rate found, attempting fresh fetch...',
      );
      const freshData = await this.fetchAndPersistDolarBlue();

      if (freshData.status === 'SUCCESS') {
        return {
          compra: freshData.compra,
          venta: freshData.venta,
        };
      }

      return null;
    }

    return {
      compra: latest.compra,
      venta: latest.venta,
    };
  }
}
