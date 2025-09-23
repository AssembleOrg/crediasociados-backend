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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { PaginationDto, ClientFiltersDto, LoanFiltersDto, ClientChartDataDto, LoanChartDataDto } from '../common/dto';
import { PaginatedResponse } from '../common/interfaces/pagination.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() currentUser: any,
  ): Promise<UserResponseDto> {
    return this.usersService.create(createUserDto, currentUser);
  }

  @Get()
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get all users with pagination' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async findAll(
    @Query() paginationDto: PaginationDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    return this.usersService.findAll(paginationDto);
  }

  @Get(':id')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Update a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: any,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, updateUserDto, currentUser);
  }

  @Delete(':id')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Delete a user (soft delete)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @Get(':id/created-users')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get users created by a specific user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Created users retrieved successfully',
  })
  async getCreatedUsers(@Param('id') id: string): Promise<UserResponseDto[]> {
    return this.usersService.getCreatedUsers(id);
  }

  @Get(':id/hierarchy')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Get user hierarchy (who created them and who they created)',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User hierarchy retrieved successfully',
  })
  async getUserHierarchy(@Param('id') id: string): Promise<{
    createdBy: UserResponseDto | null;
    createdUsers: UserResponseDto[];
  }> {
    return this.usersService.getUserHierarchy(id);
  }

  @Get(':managerId/clients')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get clients of a specific manager with pagination and filters' })
  @ApiParam({ name: 'managerId', description: 'Manager ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'fullName', required: false, type: String, example: 'John Doe' })
  @ApiQuery({ name: 'dni', required: false, type: String, example: '12345678' })
  @ApiQuery({ name: 'cuit', required: false, type: String, example: '20-12345678-9' })
  @ApiQuery({ name: 'email', required: false, type: String, example: 'client@example.com' })
  @ApiQuery({ name: 'phone', required: false, type: String, example: '+1234567890' })
  @ApiQuery({ name: 'job', required: false, type: String, example: 'Empleado' })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, example: '2024-01-01T00:00:00.000Z' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, example: '2024-12-31T23:59:59.000Z' })
  @ApiResponse({ status: 200, description: 'Manager clients retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Manager not found' })
  async getManagerClients(
    @Param('managerId') managerId: string,
    @Query() paginationDto: PaginationDto,
    @Query() filters: ClientFiltersDto,
    @CurrentUser() currentUser: any,
  ): Promise<PaginatedResponse<any>> {
    return this.usersService.getManagerClients(managerId, paginationDto, filters, currentUser);
  }

  @Get(':managerId/clients/chart')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get manager clients data for charts (no pagination, reduced data)' })
  @ApiParam({ name: 'managerId', description: 'Manager ID' })
  @ApiQuery({ name: 'fullName', required: false, type: String, example: 'John Doe' })
  @ApiQuery({ name: 'dni', required: false, type: String, example: '12345678' })
  @ApiQuery({ name: 'cuit', required: false, type: String, example: '20-12345678-9' })
  @ApiQuery({ name: 'email', required: false, type: String, example: 'client@example.com' })
  @ApiQuery({ name: 'phone', required: false, type: String, example: '+1234567890' })
  @ApiQuery({ name: 'job', required: false, type: String, example: 'Empleado' })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, example: '2024-01-01T00:00:00.000Z' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, example: '2024-12-31T23:59:59.000Z' })
  @ApiResponse({ 
    status: 200, 
    description: 'Manager clients chart data retrieved successfully',
    type: [ClientChartDataDto]
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Manager not found' })
  async getManagerClientsChart(
    @Param('managerId') managerId: string,
    @Query() filters: ClientFiltersDto,
    @CurrentUser() currentUser: any,
  ): Promise<ClientChartDataDto[]> {
    return this.usersService.getManagerClientsChart(managerId, filters, currentUser);
  }

  @Get(':managerId/loans')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get loans of a specific manager with pagination and filters' })
  @ApiParam({ name: 'managerId', description: 'Manager ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'clientId', required: false, type: String, example: 'client_id_here' })
  @ApiQuery({ name: 'loanTrack', required: false, type: String, example: 'LOAN-2024-001' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE'], example: 'ACTIVE' })
  @ApiQuery({ name: 'currency', required: false, enum: ['ARS', 'USD'], example: 'ARS' })
  @ApiQuery({ name: 'paymentFrequency', required: false, enum: ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'], example: 'WEEKLY' })
  @ApiQuery({ name: 'minAmount', required: false, type: Number, example: 10000 })
  @ApiQuery({ name: 'maxAmount', required: false, type: Number, example: 100000 })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, example: '2024-01-01T00:00:00.000Z' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, example: '2024-12-31T23:59:59.000Z' })
  @ApiResponse({ status: 200, description: 'Manager loans retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Manager not found' })
  async getManagerLoans(
    @Param('managerId') managerId: string,
    @Query() paginationDto: PaginationDto,
    @Query() filters: LoanFiltersDto,
    @CurrentUser() currentUser: any,
  ): Promise<PaginatedResponse<any>> {
    return this.usersService.getManagerLoans(managerId, paginationDto, filters, currentUser);
  }

  @Get(':managerId/loans/chart')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get manager loans data for charts (no pagination, reduced data)' })
  @ApiParam({ name: 'managerId', description: 'Manager ID' })
  @ApiQuery({ name: 'clientId', required: false, type: String, example: 'client_id_here' })
  @ApiQuery({ name: 'loanTrack', required: false, type: String, example: 'LOAN-2024-001' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE'], example: 'ACTIVE' })
  @ApiQuery({ name: 'currency', required: false, enum: ['ARS', 'USD'], example: 'ARS' })
  @ApiQuery({ name: 'paymentFrequency', required: false, enum: ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'], example: 'WEEKLY' })
  @ApiQuery({ name: 'minAmount', required: false, type: Number, example: 10000 })
  @ApiQuery({ name: 'maxAmount', required: false, type: Number, example: 100000 })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, example: '2024-01-01T00:00:00.000Z' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, example: '2024-12-31T23:59:59.000Z' })
  @ApiResponse({ 
    status: 200, 
    description: 'Manager loans chart data retrieved successfully',
    type: [LoanChartDataDto]
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Manager not found' })
  async getManagerLoansChart(
    @Param('managerId') managerId: string,
    @Query() filters: LoanFiltersDto,
    @CurrentUser() currentUser: any,
  ): Promise<LoanChartDataDto[]> {
    return this.usersService.getManagerLoansChart(managerId, filters, currentUser);
  }
} 