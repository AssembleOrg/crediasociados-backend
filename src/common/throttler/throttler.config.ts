import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { throttlerTracker } from './throttler-tracker';

/**
 * Rate limit por ruta y por usuario (o por IP real si no hay sesión). El tope
 * aplica a cada endpoint por separado. 120/min es 5 veces el pico real medido
 * de un cobrador (24/min en el autocompletado de clientes) y sigue frenando un
 * loop descontrolado. Las rutas públicas (login, refresh, consulta pública)
 * tienen su propio @Throttle más bajo sobre el throttler 'default'.
 */
export const THROTTLER_TTL_MS = 60000;
export const THROTTLER_DEFAULT_LIMIT = 120;
export const THROTTLER_ERROR_MESSAGE =
  'Demasiadas solicitudes. Esperá un minuto y volvé a intentar.';

export const throttlerModuleOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: THROTTLER_TTL_MS, limit: THROTTLER_DEFAULT_LIMIT },
  ],
  getTracker: throttlerTracker,
  errorMessage: THROTTLER_ERROR_MESSAGE,
};
