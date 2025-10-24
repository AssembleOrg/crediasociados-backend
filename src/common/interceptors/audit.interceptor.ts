import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService, AuditAction } from '../services/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, params } = request;
    const startTime = Date.now();
    const ip = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || 'Unknown';
    const endpoint = request.route?.path || request.url.split('?')[0];

    this.logger.log(
      `Request: ${method} ${url} - User: ${user?.email || 'anonymous'} - IP: ${ip}`,
    );

    return next.handle().pipe(
      tap(async (data) => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        this.logger.log(
          `Response: ${method} ${url} - Duration: ${duration}ms - Status: Success`,
        );

        // NO auditar operaciones READ (GET)
        if (method === 'GET') {
          return;
        }

        // Determinar la acción y entidad basado en el método y endpoint
        const auditInfo = this.determineAuditInfo(method, endpoint, body, params, data);

        if (auditInfo) {
          await this.auditService.log({
            userId: user?.id,
            userEmail: user?.email,
            userRole: user?.role,
            action: auditInfo.action,
            entity: auditInfo.entity,
            entityId: auditInfo.entityId,
            changes: auditInfo.changes,
            ip,
            userAgent,
            endpoint,
            method,
            statusCode: 200,
            description: auditInfo.description,
          });
        }
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

  private determineAuditInfo(
    method: string,
    endpoint: string,
    body: any,
    params: any,
    responseData: any,
  ): {
    action: AuditAction;
    entity: string;
    entityId?: string;
    changes?: any;
    description?: string;
  } | null {
    // Mapeo de acciones HTTP a AuditAction
    const actionMap: { [key: string]: AuditAction } = {
      POST: AuditAction.CREATE,
      GET: AuditAction.READ,
      PUT: AuditAction.UPDATE,
      PATCH: AuditAction.UPDATE,
      DELETE: AuditAction.DELETE,
    };

    // Determinar la entidad basado en el endpoint
    let entity = 'Unknown';
    if (endpoint.includes('/users')) entity = 'User';
    else if (endpoint.includes('/clients')) entity = 'Client';
    else if (endpoint.includes('/loans')) entity = 'Loan';
    else if (endpoint.includes('/payments')) entity = 'Payment';
    else if (endpoint.includes('/wallet')) entity = 'Wallet';
    else if (endpoint.includes('/daily-closure')) entity = 'DailyClosure';
    else if (endpoint.includes('/sub-loan')) entity = 'SubLoan';
    else if (endpoint.includes('/auth')) {
      if (endpoint.includes('/login')) {
        return {
          action: AuditAction.LOGIN,
          entity: 'Auth',
          description: 'User login attempt',
        };
      }
      return null; // No auditar otros endpoints de auth
    }

    const action = actionMap[method] || AuditAction.READ;
    const entityId = params?.id;

    // Preparar cambios según el tipo de operación
    let changes: any = undefined;
    
    if (method === 'POST') {
      // CREATE: Solo el estado después
      changes = {
        after: body,
      };
    } else if (method === 'PUT' || method === 'PATCH') {
      // UPDATE: El estado después (el before debería capturarse en el servicio si es necesario)
      changes = {
        after: body,
      };
    } else if (method === 'DELETE') {
      // DELETE: Capturar el estado BEFORE desde la respuesta del servicio
      // La respuesta puede contener la data eliminada
      const deletedData = responseData?.data || responseData;
      
      changes = {
        before: deletedData,
      };
    }

    return {
      action,
      entity,
      entityId,
      changes,
      description: `${action} operation on ${entity}`,
    };
  }
}
