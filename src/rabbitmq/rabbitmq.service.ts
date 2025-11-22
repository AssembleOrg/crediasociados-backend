import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly exchangeName = 'pistech-exchange';
  private readonly queueName: string;
  private readonly rabbitmqUrl: string;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: number; // Tiempo de expiración en segundos
  private readonly allowedOrigins: string[];
  private readonly patterns = [
    'save-history-crediasociados',
    'get-crediasociados-last',
    'send-email',
  ];

  constructor(private configService: ConfigService) {
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'pistech-automation';
    this.rabbitmqUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672';
    
    // Usar JWT secret específico para RabbitMQ (requerido)
    this.jwtSecret = this.configService.get<string>('RABBITMQ_JWT_SECRET') || '';
    if (!this.jwtSecret) {
      this.logger.warn('RABBITMQ_JWT_SECRET no configurado. Los mensajes RabbitMQ fallarán.');
    }
    
    // Obtener tiempo de expiración del JWT (por defecto 180 segundos = 3 minutos)
    const expiresInStr = this.configService.get<string>('RABBITMQ_JWT_EXPIRES_IN') || '180';
    this.jwtExpiresIn = this.parseExpiresIn(expiresInStr);
    
    this.allowedOrigins = (this.configService.get<string>('ALLOWED_ORIGINS') || '').split(',').filter(Boolean);
  }

  /**
   * Parsea el tiempo de expiración del JWT desde string a segundos
   * Soporta formatos: "180", "3m", "5m", "300s", etc.
   */
  private parseExpiresIn(expiresIn: string): number {
    const trimmed = expiresIn.trim().toLowerCase();
    
    // Si es solo un número, asumir que son segundos
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    
    // Si termina en 's', son segundos
    if (trimmed.endsWith('s')) {
      return parseInt(trimmed.slice(0, -1), 10);
    }
    
    // Si termina en 'm', son minutos
    if (trimmed.endsWith('m')) {
      return parseInt(trimmed.slice(0, -1), 10) * 60;
    }
    
    // Si termina en 'h', son horas
    if (trimmed.endsWith('h')) {
      return parseInt(trimmed.slice(0, -1), 10) * 3600;
    }
    
    // Por defecto, intentar parsear como segundos
    const parsed = parseInt(trimmed, 10);
    return isNaN(parsed) ? 180 : parsed; // Fallback a 180 segundos
  }

  async onModuleInit() {
    try {
      await this.connect();
    } catch (error) {
      this.logger.error('Error al conectar con RabbitMQ:', error);
      // No lanzamos el error para que la app pueda iniciar sin RabbitMQ
    }
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect() {
    try {
      this.connection = await amqp.connect(this.rabbitmqUrl);
      // Usar createConfirmChannel para tener confirmación de mensajes
      this.channel = await this.connection.createConfirmChannel();

      // Crear exchange
      await this.channel.assertExchange(this.exchangeName, 'direct', {
        durable: true,
      });

      // Crear cola
      await this.channel.assertQueue(this.queueName, { durable: true });

      // Bindear cada pattern a la cola
      for (const pattern of this.patterns) {
        await this.channel.bindQueue(
          this.queueName,
          this.exchangeName,
          pattern,
        );
      }

      this.logger.log(`Conectado a RabbitMQ. Exchange: ${this.exchangeName}, Cola: ${this.queueName}`);
    } catch (error) {
      this.logger.error('Error al conectar con RabbitMQ:', error);
      this.connection = null;
      this.channel = null;
      throw error;
    }
  }

  private async ensureConnection() {
    // Verificar si la conexión y el canal existen y están activos
    if (!this.connection || !this.channel) {
      await this.connect();
      return;
    }

    // Verificar si la conexión está cerrada (puede pasar si hay un error previo)
    try {
      // Intentar verificar el estado del canal
      // Si el canal está cerrado, esto lanzará un error
      if (this.channel && (this.channel as any).closed) {
        this.logger.warn('Canal de RabbitMQ está cerrado, reconectando...');
        this.connection = null;
        this.channel = null;
        await this.connect();
      }
    } catch (error) {
      // Si hay un error al verificar, asumir que la conexión está rota
      this.logger.warn('Error al verificar conexión RabbitMQ, reconectando...', error);
      this.connection = null;
      this.channel = null;
      await this.connect();
    }
  } 

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.logger.log('Desconectado de RabbitMQ');
    } catch (error) {
      this.logger.error('Error al desconectar de RabbitMQ:', error);
    }
  }

  /**
   * Genera un JWT válido para autenticación RabbitMQ
   * IMPORTANTE: Este método SIEMPRE genera un JWT nuevo con timestamp actual
   * Se genera justo antes de enviar cada mensaje para evitar expiración
   * Usa RABBITMQ_JWT_EXPIRES_IN para configurar el tiempo de expiración
   */
  private generateJWT(): string {
    if (!this.jwtSecret) {
      throw new Error('RABBITMQ_JWT_SECRET no configurado. Es requerido para enviar mensajes a RabbitMQ.');
    }
    
    // SIEMPRE obtener el timestamp actual (nunca cachear)
    // Esto asegura que cada llamada genere un JWT único y fresco
    const now = Math.floor(Date.now() / 1000);
    
    // Generar JWT con payload mínimo requerido
    // El microservicio solo necesita validar el token, no buscar un usuario
    const token = jwt.sign(
      { 
        sub: 'rabbitmq-crediasociados', // ID del sistema para RabbitMQ
        iat: now, // Issued at (ahora - SIEMPRE actual)
        exp: now + this.jwtExpiresIn, // Expira según RABBITMQ_JWT_EXPIRES_IN
        jti: `rabbitmq-${now}-${Math.random().toString(36).substring(7)}`, // JWT ID único para evitar reutilización
      },
      this.jwtSecret,
      { 
        issuer: 'crediasociados-backend',
        noTimestamp: false, // Permitir timestamp automático
      }
    );
    
    // Log para debugging (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      const decoded = jwt.decode(token) as any;
      this.logger.debug(`JWT generado: exp=${decoded.exp}, iat=${decoded.iat}, jti=${decoded.jti}, expiresIn=${this.jwtExpiresIn}s`);
    }
    
    return token;
  }

  /**
   * Envía un mensaje a RabbitMQ usando Exchange con Routing Key
   * El pattern se envía tanto como routing key como en el body del mensaje
   */
  async sendMessage(pattern: string, data: any, origin?: string): Promise<boolean> {
    try {
      await this.ensureConnection();

      if (!this.channel) {
        throw new Error('Canal de RabbitMQ no disponible');
      }

      // Validar que el pattern esté en la lista de patterns permitidos
      if (!this.patterns.includes(pattern)) {
        this.logger.warn(`Pattern no reconocido: ${pattern}. Patterns permitidos: ${this.patterns.join(', ')}`);
      }

      // ⚠️ IMPORTANTE: Generar un JWT NUEVO para cada mensaje
      // Esto asegura que cada mensaje tenga su propio token fresco
      // Nunca reutilizar tokens entre mensajes
      const token = this.generateJWT();
      
      // Verificar que el token sea válido y fresco (debugging)
      try {
        const decoded = jwt.decode(token) as any;
        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = decoded.exp - now;
        const timeSinceIssued = now - decoded.iat;
        
        if (timeUntilExpiry <= 0) {
          this.logger.warn(`⚠️ JWT ya expirado al generar! (exp=${decoded.exp}, now=${now})`);
        } else if (timeSinceIssued > 5) {
          this.logger.warn(`⚠️ JWT generado hace ${timeSinceIssued}s, puede estar desactualizado`);
        } else {
          this.logger.debug(`✅ JWT generado para pattern ${pattern} (expira en ${timeUntilExpiry}s, emitido hace ${timeSinceIssued}s)`);
        }
      } catch (e) {
        this.logger.warn(`Error al decodificar JWT para debugging: ${e.message}`);
      }

      // Los headers deben ir en las propiedades del mensaje RabbitMQ
      const messageHeaders = {
        authorization: `Bearer ${token}`,
        origin: origin || this.allowedOrigins[0] || 'https://api.crediasociados.com',
      };

      // Incluir pattern, data y JWT en el body del mensaje
      // El JWT en el body sirve como fallback si no se encuentra en headers
      // El microservicio busca en: data.token, data.headers.authorization, data.jwt
      const messageBody = {
        pattern: pattern,
        data: {
          ...data,
          token: token, // ← Para data.token (orden de búsqueda #5)
          headers: { 
            authorization: `Bearer ${token}`, // ← Para data.headers.authorization (orden #3)
          },
        },
        jwt: token, // ← JWT directo en el body como fallback adicional
      };

      // Publicar usando exchange con routing key = pattern
      // El body contiene pattern y data
      // Usar publish con confirmación para asegurar que el mensaje se envíe
      const published = this.channel.publish(
        this.exchangeName,
        pattern, // ← Routing key (mantener para compatibilidad)
        Buffer.from(JSON.stringify(messageBody)), // ← Body con pattern y data
        {
          persistent: true,
          headers: messageHeaders,
        }
      );

      if (!published) {
        this.logger.warn(`Buffer lleno, mensaje no publicado: ${pattern}`);
        return false;
      }

      // Si es un canal confirmado, esperar confirmación del mensaje
      // Esto asegura que el mensaje se haya enviado antes de continuar
      if (this.channel && typeof (this.channel as any).waitForConfirms === 'function') {
        return new Promise<boolean>((resolve) => {
          // Usar waitForConfirms con timeout para evitar esperar indefinidamente
          const timeout = setTimeout(() => {
            this.logger.warn(`Timeout esperando confirmación de mensaje: ${pattern}`);
            resolve(false);
          }, 5000); // 5 segundos de timeout

          (this.channel as any).waitForConfirms()
            .then(() => {
              clearTimeout(timeout);
              this.logger.log(`Mensaje confirmado en RabbitMQ: ${pattern}`);
              resolve(true);
            })
            .catch((confirmError: any) => {
              clearTimeout(timeout);
              this.logger.error(`Error al confirmar mensaje en RabbitMQ (${pattern}):`, confirmError);
              resolve(false);
            });
        });
      } else {
        // Si no es un canal confirmado, solo verificar que se publicó
        this.logger.log(`Mensaje enviado a RabbitMQ: ${pattern}`);
        return true;
      }
    } catch (error: any) {
      this.logger.error(`Error al enviar mensaje a RabbitMQ (${pattern}):`, error);
      
      // Si el error indica que la conexión está cerrada, limpiar el estado
      if (error.message?.includes('closed') || error.message?.includes('Connection') || error.code === 'ECONNRESET') {
        this.logger.warn(`Conexión RabbitMQ cerrada, limpiando estado para próxima reconexión`);
        try {
          this.channel = null;
          this.connection = null;
        } catch (cleanupError) {
          // Ignorar errores de limpieza
        }
      }
      
      return false;
    }
  }

  /**
   * Envía un email con adjunto PDF
   */
  async sendEmailWithPDF(
    recipients: string[],
    subject: string,
    pdfBase64: string,
    pdfFilename: string,
    htmlContent?: string,
    textContent?: string,
  ): Promise<boolean> {
    const emailData = {
      to: recipients.map(email => ({ email })),
      subject,
      htmlContent: htmlContent || this.getDefaultEmailHTML(subject, pdfFilename),
      textContent: textContent || this.getDefaultEmailText(subject, pdfFilename),
      attachments: [
        {
          name: pdfFilename,
          content: pdfBase64,
          contentType: 'application/pdf',
        },
      ],
    };

    return this.sendMessage('send-email', emailData);
  }

  /**
   * Guarda un PDF en el bucket de DigitalOcean
   */
  async saveHistoryPDF(pdfBase64: string, filename?: string): Promise<boolean> {
    // Remover el prefijo data URI si existe
    const base64Content = pdfBase64.replace(/^data:application\/pdf;base64,/, '');

    const data = {
      pdfBase64: `data:application/pdf;base64,${base64Content}`,
      filename,
    };

    return this.sendMessage('save-history-crediasociados', data);
  }

  /**
   * HTML por defecto para el email del reporte diario
   */
  private getDefaultEmailHTML(subject: string, filename: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
          }
          .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .header {
            border-bottom: 3px solid #007bff;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #007bff;
            margin: 0;
            font-size: 24px;
          }
          .content {
            margin-bottom: 30px;
          }
          .content p {
            margin-bottom: 15px;
            color: #555;
          }
          .footer {
            border-top: 1px solid #eee;
            padding-top: 20px;
            margin-top: 30px;
            text-align: center;
            color: #888;
            font-size: 12px;
          }
          .highlight {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            border-left: 4px solid #007bff;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${subject}</h1>
          </div>
          <div class="content">
            <p>Estimado/a,</p>
            <p>Se adjunta el reporte diario del sistema de préstamos correspondiente a la fecha indicada.</p>
            <div class="highlight">
              <strong>Archivo adjunto:</strong> ${filename}
            </div>
            <p>Este reporte incluye:</p>
            <ul>
              <li>Historial de transacciones de caja fuerte</li>
              <li>Movimientos de wallet de cobros</li>
              <li>Datos de clientes</li>
              <li>Estado de préstamos y subpréstamos</li>
              <li>Pagos realizados</li>
            </ul>
            <p>Por favor, revise el documento adjunto para más detalles.</p>
          </div>
          <div class="footer">
            <p>Este es un mensaje automático del sistema de gestión de préstamos.</p>
            <p>No responda a este correo.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Texto plano por defecto para el email del reporte diario
   */
  private getDefaultEmailText(subject: string, filename: string): string {
    return `
${subject}

Estimado/a,

Se adjunta el reporte diario del sistema de préstamos correspondiente a la fecha indicada.

Archivo adjunto: ${filename}

Este reporte incluye:
- Historial de transacciones de caja fuerte
- Movimientos de wallet de cobros
- Datos de clientes
- Estado de préstamos y subpréstamos
- Pagos realizados

Por favor, revise el documento adjunto para más detalles.

---
Este es un mensaje automático del sistema de gestión de préstamos.
No responda a este correo.
    `.trim();
  }
}

