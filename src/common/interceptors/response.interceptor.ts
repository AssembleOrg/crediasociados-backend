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
  message: string;
  success: boolean;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({
        data,
        message: 'Success',
        success: true,
        timestamp: DateUtil.now().toISO() || new Date().toISOString(),
      })),
    );
  }
}
