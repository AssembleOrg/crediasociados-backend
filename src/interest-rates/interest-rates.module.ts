import { Module } from '@nestjs/common';
import { InterestRatesService } from './interest-rates.service';
import { InterestRatesController } from './interest-rates.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InterestRatesController],
  providers: [InterestRatesService],
  exports: [InterestRatesService],
})
export class InterestRatesModule {} 