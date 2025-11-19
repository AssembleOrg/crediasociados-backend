import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { CollectorWalletModule } from '../collector-wallet/collector-wallet.module';

@Module({
  imports: [PrismaModule, WalletModule, CollectorWalletModule],
  controllers: [LoansController],
  providers: [LoansService, SubLoanGeneratorService],
  exports: [LoansService],
})
export class LoansModule {}
