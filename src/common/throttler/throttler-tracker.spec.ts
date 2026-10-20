import { clientIp, throttlerTracker } from './throttler-tracker';

describe('throttlerTracker', () => {
  it('usa el id del usuario autenticado antes que cualquier IP', () => {
    const req = {
      user: { id: 'cmv9weshz0841qt011gn592jo' },
      ip: '10.0.0.1',
      headers: { 'cf-connecting-ip': '181.1.2.3' },
    };
    expect(throttlerTracker(req)).toBe('user:cmv9weshz0841qt011gn592jo');
  });

  it('sin sesión cae a la IP real del cliente', () => {
    const req = { ip: '10.0.0.1', headers: { 'cf-connecting-ip': '181.1.2.3' } };
    expect(throttlerTracker(req)).toBe('ip:181.1.2.3');
  });

  it('ignora un user sin id', () => {
    const req = { user: {}, ip: '10.0.0.1', headers: {} };
    expect(throttlerTracker(req)).toBe('ip:10.0.0.1');
  });
});

describe('clientIp', () => {
  it('prefiere cf-connecting-ip', () => {
    expect(
      clientIp({
        ip: '10.0.0.1',
        headers: {
          'cf-connecting-ip': '181.1.2.3',
          'x-real-ip': '172.68.14.123',
          'x-forwarded-for': '172.68.14.123, 10.0.0.2',
        },
      }),
    ).toBe('181.1.2.3');
  });

  it('después x-real-ip', () => {
    expect(
      clientIp({
        ip: '10.0.0.1',
        headers: { 'x-real-ip': '181.1.2.3', 'x-forwarded-for': '172.68.14.123' },
      }),
    ).toBe('181.1.2.3');
  });

  it('después el primer salto de x-forwarded-for', () => {
    expect(
      clientIp({ ip: '10.0.0.1', headers: { 'x-forwarded-for': ' 181.1.2.3 , 10.0.0.2' } }),
    ).toBe('181.1.2.3');
  });

  it('acepta headers repetidos (array) y saltea valores vacíos', () => {
    expect(
      clientIp({
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': ['  ', '1.1.1.1'], 'x-real-ip': ['181.1.2.3'] },
      }),
    ).toBe('181.1.2.3');
  });

  it('cae a req.ip, al socket y por último a "unknown"', () => {
    expect(clientIp({ ip: '10.0.0.1', headers: {} })).toBe('10.0.0.1');
    expect(clientIp({ socket: { remoteAddress: '10.0.0.9' }, headers: {} })).toBe('10.0.0.9');
    expect(clientIp({})).toBe('unknown');
  });
});
