import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private logger: Logger,
  ) {}

  async validateUser(email: string, password: string) {
    this.logger.log(`Validating user ${email}`);
    // Buscar usuario con email case-insensitive usando consulta raw SQL
    // PostgreSQL: usar LOWER() para comparación case-insensitive
    // Las columnas en la BD están en camelCase (con comillas dobles)
    const users = await this.prisma.$queryRaw<Array<{
      id: string;
      email: string;
      password: string;
      fullName: string;
      role: string;
      phone: string | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      createdById: string | null;
      clientQuota: number;
      usedClientQuota: number;
      commission: number | null;
    }>>(
      Prisma.sql`
        SELECT * FROM users 
        WHERE LOWER("email") = LOWER(${email})
        AND "deletedAt" IS NULL
        LIMIT 1
      `
    );

    if (users.length === 0) {
      return null;
    }

    const user = users[0];

    if (user && (await bcrypt.compare(password, user.password))) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      }),
    ]);

    // Store refresh token
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const refreshTokenRecord = await this.prisma.refreshToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!refreshTokenRecord || refreshTokenRecord.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      const [newAccessToken, newRefreshToken] = await Promise.all([
        this.jwtService.signAsync(newPayload),
        this.jwtService.signAsync(newPayload, {
          secret: process.env.JWT_REFRESH_SECRET,
          expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
        }),
      ]);

      // Update refresh token
      await this.prisma.refreshToken.update({
        where: { id: refreshTokenRecord.id },
        data: {
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(token: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { token },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    // 1. Buscar el usuario
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    // 2. Verificar que la contraseña actual sea correcta
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }

    // 3. Hash de la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // 4. Actualizar la contraseña
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    this.logger.log(`Usuario ${user.email} cambió su contraseña exitosamente`);

    return { message: 'Contraseña actualizada exitosamente' };
  }
}
