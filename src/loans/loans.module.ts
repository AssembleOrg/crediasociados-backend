import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { LoanPdfService } from './loan-pdf.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { CollectorWalletModule } from '../collector-wallet/collector-wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, WalletModule, CollectorWalletModule, NotificationsModule],
  controllers: [LoansController],
  providers: [LoansService, SubLoanGeneratorService, LoanPdfService],
  exports: [LoansService],
})
export class LoansModule {}
