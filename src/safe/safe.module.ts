import { Module } from '@nestjs/common';
import { SafeController } from './safe.controller';
import { SafeService } from './safe.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectorWalletModule } from '../collector-wallet/collector-wallet.module';

@Module({
  imports: [PrismaModule, CollectorWalletModule],
  controllers: [SafeController],
  providers: [SafeService],
  exports: [SafeService],
})
export class SafeModule {}

