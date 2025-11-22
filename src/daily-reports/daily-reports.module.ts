import { Module } from '@nestjs/common';
import { DailyReportsService } from './daily-reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, RabbitMQModule, ConfigModule],
  providers: [DailyReportsService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}

