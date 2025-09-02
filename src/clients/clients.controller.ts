import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import {
  CreateClientDto,
  UpdateClientDto,
  ClientResponseDto,
  ClientWithDetailsDto,
} from './dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums';

@ApiTags('Clients')
@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new client (MANAGER only)' })
  @ApiResponse({
    status: 201,
    description: 'Client created successfully or existing client assigned',
    schema: {
      type: 'object',
      properties: {
        data: {
          oneOf: [
            { $ref: '#/components/schemas/ClientResponseDto' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                fullName: { type: 'string' },
                dni: { type: 'string' },
                cuit: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string' },
                address: { type: 'string' },
                job: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
                isExistingClient: { type: 'boolean' },
                message: { type: 'string' },
              },
            },
          ],
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or client already assigned',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async create(
    @Body() createClientDto: CreateClientDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.create(
      createClientDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'Get all clients with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Clients retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/ClientWithManagersDto' },
            },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query() paginationDto: PaginationDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.findAll(
      paginationDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Get('search')
  @ApiOperation({ summary: 'Search client by DNI or CUIT' })
  @ApiQuery({ name: 'dni', required: false, type: String, example: '12345678' })
  @ApiQuery({
    name: 'cuit',
    required: false,
    type: String,
    example: '20-12345678-9',
  })
  @ApiResponse({
    status: 200,
    description: 'Client found successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientWithManagersDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Missing DNI or CUIT',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async searchByDniOrCuit(
    @Query('dni') dni?: string,
    @Query('cuit') cuit?: string,
  ) {
    const result = await this.clientsService.searchByDniOrCuit(dni, cuit);
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific client by ID' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientWithDetailsDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async findOne(@Param('id') id: string, @CurrentUser() currentUser: any) {
    const result = await this.clientsService.findOne(
      id,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a client (MANAGER only)' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client updated successfully',
    schema: {
      type: 'object',
      properties: {
        data: { $ref: '#/components/schemas/ClientResponseDto' },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or duplicate DNI/CUIT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @CurrentUser() currentUser: any,
  ) {
    const result = await this.clientsService.update(
      id,
      updateClientDto,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a client (MANAGER only - soft delete)' })
  @ApiParam({ name: 'id', description: 'Client ID', example: 'cuid123' })
  @ApiResponse({
    status: 200,
    description: 'Client deleted successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        message: { type: 'string' },
        success: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async remove(@Param('id') id: string, @CurrentUser() currentUser: any) {
    const result = await this.clientsService.remove(
      id,
      currentUser.id,
      currentUser.role,
    );
    return result;
  }
}
