import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SystemConfigModule } from './system-config/system-config.module';

import { ExternalApiModule } from './external-api/external-api.module';
import { LoansModule } from './loans/loans.module';
import { ClientsModule } from './clients/clients.module';
import { SubLoansModule } from './sub-loans/sub-loans.module';
import { ScheduledTasksModule } from './scheduled-tasks/scheduled-tasks.module';
import { WalletModule } from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';
import { DailyClosureModule } from './daily-closure/daily-closure.module';
import { AuditModule } from './audit/audit.module';
import { CollectionRoutesModule } from './collection-routes/collection-routes.module';
import { CollectorWalletModule } from './collector-wallet/collector-wallet.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuditService } from './common/services/audit.service';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    SystemConfigModule,

    ExternalApiModule,
    LoansModule,
    ClientsModule,
    SubLoansModule,
    ScheduledTasksModule,
    WalletModule,
    PaymentsModule,
    DailyClosureModule,
    AuditModule,
    CollectionRoutesModule,
    CollectorWalletModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
