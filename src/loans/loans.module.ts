import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LoansController],
  providers: [LoansService, SubLoanGeneratorService],
  exports: [LoansService],
})
export class LoansModule {}
