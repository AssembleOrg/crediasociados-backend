import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * Crea una notificación persistida y la empuja por websocket al destinatario.
   * Nunca lanza: una notificación fallida no debe romper la operación de negocio.
   */
  async notify(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Prisma.InputJsonValue;
  }) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          data: params.data,
        },
      });
      this.gateway.emitToUser(params.userId, notification);
      return notification;
    } catch (error) {
      this.logger.error(
        `Error creando notificación ${params.type} para ${params.userId}: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  async findMine(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      deletedAt: null,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, deletedAt: null, readAt: null },
      }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, deletedAt: null, readAt: null },
    });
    return { count };
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }
    if (notification.readAt) return notification;

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
