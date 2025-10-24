import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  APPROVAL = 'APPROVAL',
  REJECTION = 'REJECTION',
}

export interface AuditLogData {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  action: AuditAction;
  entity: string; // 'User', 'Loan', 'Client', etc.
  entityId?: string;
  changes?: {
    before?: any;
    after?: any;
  };
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  description?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: data.userId,
          userEmail: data.userEmail,
          userRole: data.userRole,
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          changes: data.changes ? JSON.parse(JSON.stringify(data.changes)) : undefined,
          ip: data.ip,
          userAgent: data.userAgent,
          endpoint: data.endpoint,
          method: data.method,
          statusCode: data.statusCode,
          description: data.description,
        },
      });
    } catch (error) {
      // No queremos que un error en el log detenga la aplicación
      console.error('Error logging audit:', error);
    }
  }

  async logHttpRequest(data: {
    method: string;
    url: string;
    endpoint: string;
    statusCode: number;
    responseTime: number;
    ip?: string;
    userAgent?: string;
    userId?: string;
    userEmail?: string;
    requestBody?: any;
    responseBody?: any;
    queryParams?: any;
    headers?: any;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.httpLog.create({
        data: {
          method: data.method,
          url: data.url,
          endpoint: data.endpoint,
          statusCode: data.statusCode,
          responseTime: data.responseTime,
          ip: data.ip,
          userAgent: data.userAgent,
          userId: data.userId,
          userEmail: data.userEmail,
          requestBody: data.requestBody ? JSON.parse(JSON.stringify(data.requestBody)) : undefined,
          responseBody: data.responseBody ? JSON.parse(JSON.stringify(data.responseBody)) : undefined,
          queryParams: data.queryParams ? JSON.parse(JSON.stringify(data.queryParams)) : undefined,
          headers: data.headers ? JSON.parse(JSON.stringify(data.headers)) : undefined,
          errorMessage: data.errorMessage,
        },
      });
    } catch (error) {
      // No queremos que un error en el log detenga la aplicación
      console.error('Error logging HTTP request:', error);
    }
  }

  async getAuditLogs(filters?: {
    userId?: string;
    entity?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.entity) where.entity = filters.entity;
    if (filters?.action) where.action = filters.action;

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getHttpLogs(filters?: {
    method?: string;
    statusCode?: number;
    userId?: string;
    endpoint?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters?.method) where.method = filters.method;
    if (filters?.statusCode) where.statusCode = filters.statusCode;
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.endpoint) where.endpoint = { contains: filters.endpoint };

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.httpLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.httpLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

