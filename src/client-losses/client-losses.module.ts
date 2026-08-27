import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClientLossesController } from './client-losses.controller';
import { ClientLossesService } from './client-losses.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ClientLossesController],
  providers: [ClientLossesService],
  exports: [ClientLossesService],
})
export class ClientLossesModule {}
