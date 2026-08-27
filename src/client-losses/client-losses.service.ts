import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole, LoanStatus, SubLoanStatus } from 'src/common/enums';

// Ventana en la que el subadmin puede revertir una pérdida.
export const LOSS_REVERT_WINDOW_HOURS = 96;

interface LoanSnapshotItem {
  loanId: string;
  loanTrack: string;
  prevStatus: string;
  pendingAmount: number;
}

@Injectable()
export class ClientLossesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Baja de cliente por pérdida (deuda incobrable), ejecutada por el cobrador.
   * Todo borrado es lógico:
   * - Loans del cobrador con el cliente → DEFAULTED + deletedAt
   * - SubLoans de esos loans → deletedAt (salen del "dinero en calle")
   * - Relación client-manager → deletedAt + libera cupo
   * - Cliente → deletedAt si no le quedan otros cobradores
   * - DNI entra a la blacklist
   * Queda un registro ClientLoss que permite revertir dentro de las 96hs.
   */
  async markAsLoss(clientId: string, managerId: string, notes?: string) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, fullName: true, createdById: true, role: true },
    });
    if (!manager || manager.role !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Solo los MANAGER pueden dar de baja clientes por pérdida',
      );
    }

    const clientManager = await this.prisma.clientManager.findFirst({
      where: { clientId, userId: managerId, deletedAt: null },
    });
    if (!clientManager) {
      throw new ForbiddenException('No tiene permisos sobre este cliente');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true, fullName: true, dni: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const loans = await this.prisma.loan.findMany({
      where: {
        clientId,
        managerId,
        deletedAt: null,
        status: {
          in: [
            LoanStatus.PENDING,
            LoanStatus.APPROVED,
            LoanStatus.ACTIVE,
            LoanStatus.DEFAULTED,
          ],
        },
      },
      include: {
        subLoans: {
          where: { deletedAt: null },
          select: { totalAmount: true, paidAmount: true, status: true },
        },
      },
    });

    const lossAt = new Date();
    const snapshot: LoanSnapshotItem[] = loans.map((loan) => ({
      loanId: loan.id,
      loanTrack: loan.loanTrack,
      prevStatus: loan.status,
      pendingAmount: loan.subLoans.reduce(
        (sum, sl) =>
          sum + Math.max(0, Number(sl.totalAmount) - Number(sl.paidAmount)),
        0,
      ),
    }));
    const lostAmount = snapshot.reduce((sum, s) => sum + s.pendingAmount, 0);
    const loanIds = snapshot.map((s) => s.loanId);

    const loss = await this.prisma.$transaction(async (tx) => {
      // Loans y subloans: baja lógica. Salen del dinero en calle del cobrador.
      if (loanIds.length > 0) {
        await tx.loan.updateMany({
          where: { id: { in: loanIds } },
          data: { status: LoanStatus.DEFAULTED, deletedAt: lossAt },
        });
        await tx.subLoan.updateMany({
          where: { loanId: { in: loanIds }, deletedAt: null },
          data: { deletedAt: lossAt },
        });
      }

      // Desvincular del cobrador y liberar cupo
      await tx.clientManager.update({
        where: { id: clientManager.id },
        data: { deletedAt: lossAt },
      });
      await tx.user.update({
        where: { id: managerId },
        data: { usedClientQuota: { decrement: 1 } },
      });

      // Cliente: baja lógica solo si no le quedan otros cobradores activos
      const remainingManagers = await tx.clientManager.count({
        where: { clientId, deletedAt: null },
      });
      if (remainingManagers === 0) {
        await tx.client.update({
          where: { id: clientId },
          data: { deletedAt: lossAt },
        });
      }

      // Blacklist por DNI (si no está ya)
      let blacklistId: string | null = null;
      if (client.dni) {
        const existing = await tx.blacklistedClient.findFirst({
          where: { dni: client.dni },
        });
        if (!existing) {
          const entry = await tx.blacklistedClient.create({
            data: {
              dni: client.dni,
              fullName: client.fullName,
              reason: `Pérdida — baja por cobrador ${manager.fullName}`,
              createdBy: managerId,
            },
          });
          blacklistId = entry.id;
        }
      }

      return tx.clientLoss.create({
        data: {
          clientId,
          managerId,
          notes,
          lostAmount: new Prisma.Decimal(lostAmount),
          loansSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          lossAt,
          blacklistId,
        },
      });
    });

    // Notificar al subadmin del cobrador (fuera de la transacción)
    if (manager.createdById) {
      const revertibleUntil = new Date(
        lossAt.getTime() + LOSS_REVERT_WINDOW_HOURS * 60 * 60 * 1000,
      );
      await this.notificationsService.notify({
        userId: manager.createdById,
        type: NotificationType.CLIENT_LOSS,
        title: 'Cliente dado de baja por pérdida',
        message: `${manager.fullName} dio de baja por pérdida al cliente ${client.fullName} con una deuda pendiente de $${lostAmount.toLocaleString('es-AR')}`,
        data: {
          clientLossId: loss.id,
          clientId,
          clientName: client.fullName,
          clientDni: client.dni,
          managerId,
          managerName: manager.fullName,
          lostAmount,
          loans: snapshot as unknown as Prisma.InputJsonValue[],
          revertibleUntil: revertibleUntil.toISOString(),
        },
      });
    }

    return {
      ...loss,
      message: 'Cliente dado de baja por pérdida exitosamente',
    };
  }

  /**
   * Revierte una pérdida (solo subadmin del cobrador, o admin/superadmin)
   * dentro de la ventana de 96hs. Restaura cliente, relación, loans,
   * subloans, cupo y saca el DNI de la blacklist.
   */
  async revert(lossId: string, userId: string, userRole: UserRole) {
    const loss = await this.prisma.clientLoss.findFirst({
      where: { id: lossId, deletedAt: null },
      include: {
        manager: {
          select: { id: true, fullName: true, createdById: true },
        },
        client: { select: { id: true, fullName: true, deletedAt: true } },
      },
    });
    if (!loss) {
      throw new NotFoundException('Registro de pérdida no encontrado');
    }
    if (loss.revertedAt) {
      throw new BadRequestException('Esta pérdida ya fue revertida');
    }

    const expiresAt = new Date(
      loss.createdAt.getTime() + LOSS_REVERT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    if (new Date() > expiresAt) {
      throw new BadRequestException(
        `La ventana de ${LOSS_REVERT_WINDOW_HOURS}hs para revertir esta pérdida ya expiró`,
      );
    }

    if (userRole === UserRole.SUBADMIN) {
      if (loss.manager.createdById !== userId) {
        throw new ForbiddenException(
          'Solo puede revertir pérdidas de sus propios cobradores',
        );
      }
    } else if (
      userRole !== UserRole.ADMIN &&
      userRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException('No tiene permisos para revertir pérdidas');
    }

    const snapshot = (loss.loansSnapshot as unknown as LoanSnapshotItem[]) || [];
    const loanIds = snapshot.map((s) => s.loanId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Restaurar cliente
      await tx.client.update({
        where: { id: loss.clientId },
        data: { deletedAt: null },
      });

      // Restaurar relación client-manager y volver a ocupar cupo
      const clientManager = await tx.clientManager.findFirst({
        where: { clientId: loss.clientId, userId: loss.managerId },
      });
      if (clientManager) {
        if (clientManager.deletedAt) {
          await tx.clientManager.update({
            where: { id: clientManager.id },
            data: { deletedAt: null },
          });
          await tx.user.update({
            where: { id: loss.managerId },
            data: { usedClientQuota: { increment: 1 } },
          });
        }
      } else {
        await tx.clientManager.create({
          data: { clientId: loss.clientId, userId: loss.managerId },
        });
        await tx.user.update({
          where: { id: loss.managerId },
          data: { usedClientQuota: { increment: 1 } },
        });
      }

      // Restaurar loans a su estado previo y resucitar solo los subloans
      // que fueron borrados por esta pérdida (deletedAt == lossAt)
      for (const item of snapshot) {
        await tx.loan.update({
          where: { id: item.loanId },
          data: {
            status: item.prevStatus as LoanStatus,
            deletedAt: null,
          },
        });
      }
      if (loanIds.length > 0) {
        await tx.subLoan.updateMany({
          where: { loanId: { in: loanIds }, deletedAt: loss.lossAt },
          data: { deletedAt: null },
        });
      }

      // Sacar de la blacklist la entrada creada por esta pérdida
      if (loss.blacklistId) {
        await tx.blacklistedClient.deleteMany({
          where: { id: loss.blacklistId },
        });
      }

      return tx.clientLoss.update({
        where: { id: loss.id },
        data: { revertedAt: new Date(), revertedById: userId },
      });
    });

    // Avisar al cobrador que su baja fue revertida
    await this.notificationsService.notify({
      userId: loss.managerId,
      type: NotificationType.CLIENT_LOSS_REVERTED,
      title: 'Baja por pérdida revertida',
      message: `La baja por pérdida del cliente ${loss.client.fullName} fue revertida por el subadmin. El cliente y sus préstamos vuelven a estar activos.`,
      data: {
        clientLossId: loss.id,
        clientId: loss.clientId,
        clientName: loss.client.fullName,
      },
    });

    return {
      ...updated,
      message: 'Pérdida revertida exitosamente',
    };
  }

  /**
   * Listado de pérdidas, filtrado por rol:
   * MANAGER ve las suyas; SUBADMIN las de sus cobradores; ADMIN/SUPERADMIN todas.
   */
  async findAll(userId: string, userRole: UserRole, page = 1, limit = 20) {
    let where: Prisma.ClientLossWhereInput = { deletedAt: null };

    if (userRole === UserRole.MANAGER) {
      where = { ...where, managerId: userId };
    } else if (userRole === UserRole.SUBADMIN) {
      where = { ...where, manager: { createdById: userId } };
    }

    const [items, total] = await Promise.all([
      this.prisma.clientLoss.findMany({
        where,
        include: {
          client: { select: { id: true, fullName: true, dni: true } },
          manager: { select: { id: true, fullName: true, email: true } },
          revertedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientLoss.count({ where }),
    ]);

    const now = Date.now();
    const windowMs = LOSS_REVERT_WINDOW_HOURS * 60 * 60 * 1000;
    return {
      items: items.map((loss) => ({
        ...loss,
        canRevert:
          !loss.revertedAt && now - loss.createdAt.getTime() <= windowMs,
        revertibleUntil: new Date(
          loss.createdAt.getTime() + windowMs,
        ).toISOString(),
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
