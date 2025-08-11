import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

interface InterestRateRule {
  daysOverdue: number;
  interestRate: number;
}

@Injectable()
export class InterestRatesService {
  constructor(private prisma: PrismaService) {}

  async initializeDefaultRates(subAdminId: string): Promise<void> {
    // Default interest rate table based on your requirements
    const defaultRates: InterestRateRule[] = [
      { daysOverdue: 10, interestRate: 15.0 },
      { daysOverdue: 15, interestRate: 20.0 },
      { daysOverdue: 20, interestRate: 25.0 },
      { daysOverdue: 26, interestRate: 30.0 },
      { daysOverdue: 27, interestRate: 35.0 },
      { daysOverdue: 30, interestRate: 41.0 },
    ];

    // Check if rates already exist for this SUBADMIN
    const existingRates = await this.prisma.interestRateConfig.findMany({
      where: { subAdminId, isActive: true },
    });

    if (existingRates.length > 0) {
      return; // Already initialized
    }

    // Create default rates
    await this.prisma.interestRateConfig.createMany({
      data: defaultRates.map((rate) => ({
        subAdminId,
        daysOverdue: rate.daysOverdue,
        interestRate: rate.interestRate,
        isActive: true,
      })),
    });
  }

  async getInterestRatesForSubAdmin(subAdminId: string): Promise<InterestRateRule[]> {
    const rates = await this.prisma.interestRateConfig.findMany({
      where: {
        subAdminId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: {
        daysOverdue: 'asc',
      },
    });

    return rates.map((rate) => ({
      daysOverdue: rate.daysOverdue,
      interestRate: Number(rate.interestRate),
    }));
  }

  async updateInterestRates(
    subAdminId: string,
    rates: InterestRateRule[],
    currentUserId: string,
  ): Promise<void> {
    // Verify that the current user is the SUBADMIN or has permission
    const currentUser = await this.prisma.user.findUnique({
      where: { id: currentUserId },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    // Only SUBADMIN can modify their own rates, or ADMIN/SUPERADMIN can modify any
    if (
      currentUser.role === UserRole.SUBADMIN &&
      currentUser.id !== subAdminId
    ) {
      throw new ForbiddenException('You can only modify your own interest rates');
    }

    if (
      currentUser.role === UserRole.MANAGER
    ) {
      throw new ForbiddenException('MANAGER users cannot modify interest rates');
    }

    // Validate rates
    this.validateInterestRates(rates);

    // Deactivate existing rates
    await this.prisma.interestRateConfig.updateMany({
      where: { subAdminId, isActive: true },
      data: { isActive: false },
    });

    // Create new rates
    await this.prisma.interestRateConfig.createMany({
      data: rates.map((rate) => ({
        subAdminId,
        daysOverdue: rate.daysOverdue,
        interestRate: rate.interestRate,
        isActive: true,
      })),
    });
  }

  async getInterestRateForDays(subAdminId: string, daysOverdue: number): Promise<number> {
    // If no days overdue, return 0
    if (daysOverdue <= 0) {
      return 0;
    }

    const rates = await this.getInterestRatesForSubAdmin(subAdminId);
    
    if (rates.length === 0) {
      // Initialize default rates if none exist
      await this.initializeDefaultRates(subAdminId);
      return this.getInterestRateForDays(subAdminId, daysOverdue);
    }

    // Find the appropriate rate based on days overdue
    // Use the highest applicable rate (e.g., if 28 days overdue, use 27+ days rate)
    let applicableRate = 0;
    
    for (const rate of rates) {
      if (daysOverdue >= rate.daysOverdue) {
        applicableRate = rate.interestRate;
      }
    }

    return applicableRate;
  }

  async getManagerSubAdmin(managerId: string): Promise<string | null> {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      include: {
        createdBy: true,
      },
    });

    if (!manager || manager.role !== UserRole.MANAGER) {
      return null;
    }

    // Find the SUBADMIN who created this MANAGER
    if (manager.createdBy && manager.createdBy.role === UserRole.SUBADMIN) {
      return manager.createdBy.id;
    }

    return null;
  }

  private validateInterestRates(rates: InterestRateRule[]): void {
    if (rates.length === 0) {
      throw new BadRequestException('At least one interest rate must be provided');
    }

    // Check for duplicate days
    const days = rates.map(r => r.daysOverdue);
    const uniqueDays = new Set(days);
    if (days.length !== uniqueDays.size) {
      throw new BadRequestException('Duplicate days overdue are not allowed');
    }

    // Validate each rate
    for (const rate of rates) {
      if (rate.daysOverdue < 0) {
        throw new BadRequestException('Days overdue cannot be negative');
      }
      if (rate.interestRate < 0 || rate.interestRate > 100) {
        throw new BadRequestException('Interest rate must be between 0 and 100');
      }
    }

    // Check that rates are generally increasing (warning, not error)
    const sortedRates = [...rates].sort((a, b) => a.daysOverdue - b.daysOverdue);
    for (let i = 1; i < sortedRates.length; i++) {
      if (sortedRates[i].interestRate < sortedRates[i - 1].interestRate) {
        // This is just a warning - rates can decrease if needed
        console.warn(
          `Interest rate for ${sortedRates[i].daysOverdue} days (${sortedRates[i].interestRate}%) ` +
          `is lower than rate for ${sortedRates[i - 1].daysOverdue} days (${sortedRates[i - 1].interestRate}%)`
        );
      }
    }
  }
} 