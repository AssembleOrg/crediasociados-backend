import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { SubLoansModule } from '../sub-loans/sub-loans.module';
import { CollectionRoutesModule } from '../collection-routes/collection-routes.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SubLoansModule,
    CollectionRoutesModule,
  ],
  controllers: [ScheduledTasksController],
  providers: [ScheduledTasksService],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
