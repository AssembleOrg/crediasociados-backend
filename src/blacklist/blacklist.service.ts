import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlacklistService {
  constructor(private prisma: PrismaService) {}

  async addToBlacklist(params: {
    dni?: string | null;
    cuit?: string | null;
    fullName: string;
    reason: string;
    userId: string;
    clientId?: string | null;
    clientLossId?: string | null;
  }) {
    const { dni, cuit, fullName, reason, userId, clientId, clientLossId } =
      params;

    if (!dni && !cuit) {
      throw new BadRequestException('Debe proporcionar al menos DNI o CUIT');
    }

    // Solo consideran las entradas activas (deletedAt: null): una entrada
    // dada de baja lógicamente NO bloquea ni cuenta como duplicado.
    const existing = await this.findActiveMatch(dni, cuit);
    if (existing) {
      throw new BadRequestException(
        `El ${dni ? `DNI ${dni}` : `CUIT ${cuit}`} ya está en la lista negra`,
      );
    }

    return this.prisma.blacklistedClient.create({
      data: {
        dni: dni ?? null,
        cuit: cuit ?? null,
        fullName,
        reason,
        createdBy: userId,
        clientId: clientId ?? null,
        clientLossId: clientLossId ?? null,
      },
    });
  }

  /**
   * Baja lógica: la entrada queda fuera de la lista (no bloquea, no aparece)
   * pero se conserva para auditoría. Puede haberse agregado por error.
   */
  async removeFromBlacklist(id: string) {
    const entry = await this.prisma.blacklistedClient.findFirst({
      where: { id, deletedAt: null },
    });

    if (!entry) {
      throw new NotFoundException('Entrada no encontrada en la lista negra');
    }

    return this.prisma.blacklistedClient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getAll() {
    return this.prisma.blacklistedClient.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Chequea si un DNI y/o CUIT está en la blacklist activa (compartida entre
   * todos los subadmins). Retorna la entrada si existe, null si no.
   */
  async check(dni?: string | null, cuit?: string | null) {
    if (!dni && !cuit) return null;
    return this.findActiveMatch(dni, cuit);
  }

  private async findActiveMatch(dni?: string | null, cuit?: string | null) {
    const or: Prisma.BlacklistedClientWhereInput[] = [];
    if (dni) or.push({ dni });
    if (cuit) or.push({ cuit });
    if (or.length === 0) return null;

    return this.prisma.blacklistedClient.findFirst({
      where: { deletedAt: null, OR: or },
    });
  }
}
