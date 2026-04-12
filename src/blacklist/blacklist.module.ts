import { Module } from '@nestjs/common';
import { BlacklistController } from './blacklist.controller';
import { BlacklistService } from './blacklist.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BlacklistController],
  providers: [BlacklistService],
  exports: [BlacklistService],
})
export class BlacklistModule {}
