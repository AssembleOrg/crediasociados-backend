import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlacklistService {
  constructor(private prisma: PrismaService) {}

  async addToBlacklist(
    dni: string,
    fullName: string,
    reason: string,
    userId: string,
  ) {
    // Verificar si ya existe
    const existing = await this.prisma.blacklistedClient.findFirst({
      where: { dni },
    });

    if (existing) {
      throw new BadRequestException(
        `El DNI ${dni} ya está en la lista negra`,
      );
    }

    return this.prisma.blacklistedClient.create({
      data: { dni, fullName, reason, createdBy: userId },
    });
  }

  async removeFromBlacklist(id: string) {
    const entry = await this.prisma.blacklistedClient.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException('Entrada no encontrada en la lista negra');
    }

    return this.prisma.blacklistedClient.delete({ where: { id } });
  }

  async getAll() {
    return this.prisma.blacklistedClient.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Chequea si un DNI está en la blacklist.
   * Retorna la entrada si existe, null si no.
   */
  async checkDni(dni: string) {
    if (!dni) return null;
    return this.prisma.blacklistedClient.findFirst({
      where: { dni },
    });
  }
}
