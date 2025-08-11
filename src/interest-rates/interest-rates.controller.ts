import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { InterestRatesService } from './interest-rates.service';
import { UpdateInterestRatesDto, InterestRateRuleDto } from './dto/update-interest-rates.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Interest Rates Configuration')
@Controller('interest-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class InterestRatesController {
  constructor(private readonly interestRatesService: InterestRatesService) {}

  @Get('subadmin/:subAdminId')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get interest rate configuration for a SUBADMIN' })
  @ApiParam({ name: 'subAdminId', description: 'SUBADMIN user ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Interest rates retrieved successfully',
    type: [InterestRateRuleDto]
  })
  async getInterestRates(@Param('subAdminId') subAdminId: string): Promise<InterestRateRuleDto[]> {
    return this.interestRatesService.getInterestRatesForSubAdmin(subAdminId);
  }

  @Put('subadmin/:subAdminId')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Update interest rate configuration for a SUBADMIN' })
  @ApiParam({ name: 'subAdminId', description: 'SUBADMIN user ID' })
  @ApiResponse({ status: 200, description: 'Interest rates updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  async updateInterestRates(
    @Param('subAdminId') subAdminId: string,
    @Body() updateInterestRatesDto: UpdateInterestRatesDto,
    @CurrentUser() currentUser: any,
  ): Promise<{ message: string }> {
    await this.interestRatesService.updateInterestRates(
      subAdminId,
      updateInterestRatesDto.rates,
      currentUser.id,
    );

    return { message: 'Interest rates updated successfully' };
  }

  @Get('my-rates')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get my interest rate configuration (SUBADMIN only)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Your interest rates retrieved successfully',
    type: [InterestRateRuleDto]
  })
  async getMyInterestRates(@CurrentUser() currentUser: any): Promise<InterestRateRuleDto[]> {
    return this.interestRatesService.getInterestRatesForSubAdmin(currentUser.id);
  }

  @Put('my-rates')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Update my interest rate configuration (SUBADMIN only)' })
  @ApiResponse({ status: 200, description: 'Your interest rates updated successfully' })
  async updateMyInterestRates(
    @Body() updateInterestRatesDto: UpdateInterestRatesDto,
    @CurrentUser() currentUser: any,
  ): Promise<{ message: string }> {
    await this.interestRatesService.updateInterestRates(
      currentUser.id,
      updateInterestRatesDto.rates,
      currentUser.id,
    );

    return { message: 'Your interest rates updated successfully' };
  }

  @Get('for-manager/:managerId')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.SUBADMIN)
  @ApiOperation({ summary: 'Get interest rates that apply to a specific MANAGER' })
  @ApiParam({ name: 'managerId', description: 'MANAGER user ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Interest rates for manager retrieved successfully',
    type: [InterestRateRuleDto]
  })
  async getInterestRatesForManager(@Param('managerId') managerId: string): Promise<{
    subAdminId: string;
    rates: InterestRateRuleDto[];
  }> {
    const subAdminId = await this.interestRatesService.getManagerSubAdmin(managerId);
    
    if (!subAdminId) {
      throw new Error('Manager not found or not associated with a SUBADMIN');
    }

    const rates = await this.interestRatesService.getInterestRatesForSubAdmin(subAdminId);
    
    return {
      subAdminId,
      rates,
    };
  }
} 