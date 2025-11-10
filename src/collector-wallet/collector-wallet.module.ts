import { Module } from '@nestjs/common';
import { CollectorWalletService } from './collector-wallet.service';
import { CollectorWalletController } from './collector-wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CollectorWalletController],
  providers: [CollectorWalletService],
  exports: [CollectorWalletService],
})
export class CollectorWalletModule {}

