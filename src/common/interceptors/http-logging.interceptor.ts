import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../services/audit.service';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    // Extraer información del request
    const method = request.method;
    const url = request.url;
    const endpoint = request.route?.path || request.url.split('?')[0];
    const ip = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || 'Unknown';
    const user = request.user; // Del JWT si está autenticado

    // Preparar body y query params (clonar para evitar mutaciones)
    const requestBody = this.sanitizeBody(request.body);
    const queryParams = request.query;

    // Headers importantes (sin tokens sensibles)
    const headers = this.sanitizeHeaders(request.headers);

    return next.handle().pipe(
      tap((data) => {
        const responseTime = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log solo si no es una ruta de health check
        if (!this.shouldSkipLogging(endpoint)) {
          this.auditService.logHttpRequest({
            method,
            url,
            endpoint,
            statusCode,
            responseTime,
            ip,
            userAgent,
            userId: user?.id,
            userEmail: user?.email,
            requestBody,
            queryParams,
            headers,
            responseBody: this.shouldLogResponseBody(endpoint) && !Buffer.isBuffer(data)
              ? this.truncateIfNeeded(data)
              : undefined,
          });
        }
      }),
      catchError((error) => {
        const responseTime = Date.now() - startTime;
        const statusCode = error.status || 500;

        if (!this.shouldSkipLogging(endpoint)) {
          this.auditService.logHttpRequest({
            method,
            url,
            endpoint,
            statusCode,
            responseTime,
            ip,
            userAgent,
            userId: user?.id,
            userEmail: user?.email,
            requestBody,
            queryParams,
            headers,
            errorMessage: error.message || 'Unknown error',
          });
        }

        return throwError(() => error);
      }),
    );
  }

  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'Unknown'
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return null;

    const sanitized = { ...body };

    // Ocultar campos sensibles
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    });

    return sanitized;
  }

  private sanitizeHeaders(headers: any): any {
    const important = {
      'content-type': headers['content-type'],
      'user-agent': headers['user-agent'],
      origin: headers['origin'],
      referer: headers['referer'],
      // NO incluir Authorization por seguridad
    };

    return important;
  }

  private shouldSkipLogging(endpoint: string): boolean {
    // No logear endpoints de health check, metrics, etc.
    const skipPatterns = ['/health', '/metrics', '/favicon.ico'];
    return skipPatterns.some((pattern) => endpoint.includes(pattern));
  }

  private shouldLogResponseBody(endpoint: string): boolean {
    // No logear response body para endpoints que devuelven mucha data
    const skipResponseBodyPatterns = ['/audit-logs', '/http-logs'];
    return !skipResponseBodyPatterns.some((pattern) =>
      endpoint.includes(pattern),
    );
  }

  private truncateIfNeeded(data: any, maxLength: number = 5000): any {
    // Si es un Buffer o tiene estructura circular, no intentar serializar
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      return { _type: 'binary', _size: data.length };
    }
    
    try {
      const stringified = JSON.stringify(data);
      if (stringified.length > maxLength) {
        return {
          _truncated: true,
          _originalLength: stringified.length,
          _preview: stringified.substring(0, maxLength) + '...',
        };
      }
      return data;
    } catch (error) {
      // Si hay error de serialización (estructura circular), devolver un resumen
      return { _type: 'non-serializable', _error: 'Circular structure or non-serializable object' };
    }
  }
}

