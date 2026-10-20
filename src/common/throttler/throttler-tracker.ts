/**
 * Clave del rate limit (ThrottlerGuard).
 *
 * Todo el tráfico del frontend entra por el rewrite de Next (API_URL privado),
 * así que `req.ip` es siempre la IP del proxy: con el tracker por defecto todos
 * los usuarios compartían un único bucket y los topes "por IP" eran globales.
 *
 * - Con sesión (JwtAuthGuard ya corrió, es APP_GUARD antes del throttler):
 *   bucket por usuario, nadie afecta el bucket de otro.
 * - Sin sesión (login, refresh, consulta pública): IP real del cliente según
 *   los headers que dejan Cloudflare / el proxy, con `req.ip` como último
 *   recurso.
 */
export function throttlerTracker(req: Record<string, any>): string {
  const userId = req?.user?.id;
  if (typeof userId === 'string' && userId) return `user:${userId}`;
  return `ip:${clientIp(req)}`;
}

export function clientIp(req: Record<string, any>): string {
  const headers: Record<string, unknown> = req?.headers ?? {};

  const cloudflare = firstHeaderValue(headers['cf-connecting-ip']);
  if (cloudflare) return cloudflare;

  const realIp = firstHeaderValue(headers['x-real-ip']);
  if (realIp) return realIp;

  const forwardedFor = firstHeaderValue(headers['x-forwarded-for']);
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim();
    if (first) return first;
  }

  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

function firstHeaderValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}
