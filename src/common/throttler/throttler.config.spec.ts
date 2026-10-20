import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import {
  THROTTLER_DEFAULT_LIMIT,
  THROTTLER_ERROR_MESSAGE,
  throttlerModuleOptions,
} from './throttler.config';

/** Imita a JwtAuthGuard: deja req.user si viene el header x-test-user. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user'];
    if (userId) req.user = { id: userId };
    return true;
  }
}

@Controller('t')
class TestController {
  @Get('default')
  withDefault() {
    return { ok: true };
  }

  @Get('public')
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  withOverride() {
    return { ok: true };
  }
}

describe('throttler config (integración con ThrottlerGuard real)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerModuleOptions)],
      controllers: [TestController],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const hit = (path: string, headers: Record<string, string> = {}) =>
    request(app.getHttpServer()).get(path).set(headers);

  it('cada usuario tiene su propio bucket: agotar el de uno no afecta a otro', async () => {
    for (let i = 0; i < THROTTLER_DEFAULT_LIMIT; i++) {
      await hit('/t/default', { 'x-test-user': 'a' }).expect(200);
    }
    const blocked = await hit('/t/default', { 'x-test-user': 'a' }).expect(429);
    expect(blocked.body.message).toBe(THROTTLER_ERROR_MESSAGE);
    expect(blocked.headers['retry-after']).toBeDefined();

    await hit('/t/default', { 'x-test-user': 'b' }).expect(200);
  });

  it('el bucket es por ruta: agotar una ruta no bloquea otra del mismo usuario', async () => {
    for (let i = 0; i < THROTTLER_DEFAULT_LIMIT; i++) {
      await hit('/t/default', { 'x-test-user': 'a' }).expect(200);
    }
    await hit('/t/default', { 'x-test-user': 'a' }).expect(429);
    await hit('/t/public', { 'x-test-user': 'a' }).expect(200);
  });

  it('sin sesión separa por IP real (cf-connecting-ip), no por la IP del proxy', async () => {
    await hit('/t/public', { 'cf-connecting-ip': '181.1.1.1' }).expect(200);
    await hit('/t/public', { 'cf-connecting-ip': '181.1.1.1' }).expect(200);
    await hit('/t/public', { 'cf-connecting-ip': '181.1.1.1' }).expect(429);
    // Misma IP de socket (supertest), otra IP real: bucket distinto
    await hit('/t/public', { 'cf-connecting-ip': '181.2.2.2' }).expect(200);
  });

  it('el @Throttle de la ruta pisa el tope default del throttler "default"', async () => {
    await hit('/t/public', { 'x-test-user': 'a' }).expect(200);
    await hit('/t/public', { 'x-test-user': 'a' }).expect(200);
    await hit('/t/public', { 'x-test-user': 'a' }).expect(429);
  });
});
