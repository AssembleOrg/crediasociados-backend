import { Module } from '@nestjs/common';
import { DailyClosureService } from './daily-closure.service';
import { DailyClosureController } from './daily-closure.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DailyClosureController],
  providers: [DailyClosureService],
  exports: [DailyClosureService],
})
export class DailyClosureModule {}
