import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

type AuthedSocket = Socket & { data: { userId?: string } };

/**
 * Gateway de notificaciones in-app.
 * El cliente se conecta al namespace /notifications enviando el JWT en
 * auth.token (o Authorization header). Cada usuario entra a su room user:{id}
 * y recibe eventos "notification" en tiempo real.
 */
@WebSocketGateway({
  namespace: '/notifications',
  // Bajo el prefijo /api/v1 para que el proxy/rewrite del frontend Next
  // (que solo reenvía /api/*) alcance el handshake de socket.io con la
  // cookie de sesión (SameSite=lax exige same-origin en el browser).
  path: '/api/v1/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: AuthedSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const userId = payload.sub;
      if (!userId) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;
      await client.join(`user:${userId}`);
      this.logger.log(`Usuario ${userId} conectado a notificaciones`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    if (client.data?.userId) {
      this.logger.log(
        `Usuario ${client.data.userId} desconectado de notificaciones`,
      );
    }
  }

  /**
   * Envía una notificación en tiempo real al usuario destinatario.
   * Si no está conectado, no pasa nada: la notificación queda persistida
   * en DB y la ve al consultar su bandeja.
   */
  emitToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    const cookies = client.handshake.headers?.cookie;
    if (cookies) {
      const match = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    return null;
  }
}
