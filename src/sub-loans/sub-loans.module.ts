import { Module } from '@nestjs/common';
import { SubLoansController } from './sub-loans.controller';
import { SubLoansService } from './sub-loans.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SubLoansController],
  providers: [SubLoansService],
  exports: [SubLoansService],
})
export class SubLoansModule {}
