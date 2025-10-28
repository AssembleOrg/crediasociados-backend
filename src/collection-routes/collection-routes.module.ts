import { Module } from '@nestjs/common';
import { CollectionRoutesController } from './collection-routes.controller';
import { CollectionRoutesService } from './collection-routes.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CollectionRoutesController],
  providers: [CollectionRoutesService],
  exports: [CollectionRoutesService],
})
export class CollectionRoutesModule {}

