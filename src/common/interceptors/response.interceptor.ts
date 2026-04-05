import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DateUtil } from '../utils';

export interface Response<T> {
  data: T;
  meta?: unknown;
  message: string;
  success: boolean;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  private isPaginatedResponse(
    value: unknown,
  ): value is { data: unknown; meta: unknown } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'data' in value &&
      'meta' in value
    );
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        if (this.isPaginatedResponse(data)) {
          return {
            data: data.data as T,
            meta: data.meta,
            message: 'Success',
            success: true,
            timestamp: DateUtil.now().toISO() || new Date().toISOString(),
          };
        }

        return {
          data,
          message: 'Success',
          success: true,
          timestamp: DateUtil.now().toISO() || new Date().toISOString(),
        };
      }),
    );
  }
}
