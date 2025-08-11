import { Module } from '@nestjs/common';
import { ExternalApiService } from './external-api.service';
import { ExternalApiController } from './external-api.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExternalApiController],
  providers: [ExternalApiService],
  exports: [ExternalApiService],
})
export class ExternalApiModule {} 