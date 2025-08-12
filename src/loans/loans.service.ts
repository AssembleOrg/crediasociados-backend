import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { TrackingCodeUtil } from '../common/utils/tracking-code.util';
import { SubLoanGeneratorService } from './sub-loan-generator.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private subLoanGenerator: SubLoanGeneratorService
  ) {}

  async createLoan(createLoanDto: CreateLoanDto, userId: string) {
    // Verificar si el cliente existe y es gestionado por el usuario
    const clientManager = await this.prisma.clientManager.findFirst({
      where: {
        clientId: createLoanDto.clientId,
        userId: userId,
        deletedAt: null,
      },
    });

    if (!clientManager) {
      throw new BadRequestException('Cliente no encontrado o no gestionado por el usuario');
    }

    // Generar o usar el código de tracking
    let loanTrack: string;
    let prefix: string;
    let year: number;
    let sequence: number;
    
    if (!createLoanDto.loanTrack) {
      // Generar código automáticamente usando secuencia atómica
      const trackingData = await TrackingCodeUtil.generateSequentialTrackingCode(this.prisma, 'CREDITO');
      loanTrack = trackingData.trackingCode;
      prefix = trackingData.prefix;
      year = trackingData.year;
      sequence = trackingData.sequence;
    } else {
      // Usar código personalizado
      loanTrack = createLoanDto.loanTrack;
      
      // Verificar que el código personalizado sea único
      const existingLoan = await this.prisma.loan.findUnique({
        where: { loanTrack: loanTrack },
      });

      if (existingLoan) {
        throw new BadRequestException('El código de tracking ya existe en el sistema');
      }
      
      // Para códigos personalizados, extraer información si es posible
      const parts = loanTrack.split('-');
      if (parts.length >= 3) {
        prefix = parts[0];
        year = parseInt(parts[1]) || new Date().getFullYear();
        sequence = parseInt(parts[2]) || 0;
      } else {
        prefix = 'CUSTOM';
        year = new Date().getFullYear();
        sequence = 0;
      }
    }

    // Usar transacción para crear el loan y los subloans
    const result = await this.prisma.$transaction(async (prisma) => {
      // Crear el préstamo
      const loan = await prisma.loan.create({
        data: {
          clientId: createLoanDto.clientId,
          amount: createLoanDto.amount,
          originalAmount: createLoanDto.amount,
          currency: createLoanDto.currency || 'ARS',
          paymentFrequency: createLoanDto.paymentFrequency,
          paymentDay: createLoanDto.paymentDay,
          totalPayments: createLoanDto.totalPayments,
          firstDueDate: createLoanDto.firstDueDate ? new Date(createLoanDto.firstDueDate) : null,
          loanTrack: loanTrack,
          prefix: prefix,
          year: year,
          sequence: sequence,
          description: createLoanDto.description,
          notes: createLoanDto.notes,
          baseInterestRate: createLoanDto.baseInterestRate,
          penaltyInterestRate: createLoanDto.penaltyInterestRate,
        },
        include: {
          client: true,
        },
      });

      // Generar SubLoans automáticamente
      await this.subLoanGenerator.generateSubLoans(
        loan.id,
        createLoanDto,
        createLoanDto.firstDueDate ? new Date(createLoanDto.firstDueDate) : undefined
      );

      // Obtener el loan con los subloans generados
      const loanWithSubLoans = await prisma.loan.findUnique({
        where: { id: loan.id },
        include: {
          client: true,
          subLoans: {
            orderBy: { paymentNumber: 'asc' },
          },
        },
      });

      return loanWithSubLoans;
    });

    return result;
  }

  async getLoanByTracking(dni: string, loanTrack: string) {
    // Find the loan by tracking code and verify DNI matches
    const loan = await this.prisma.loan.findFirst({
      where: {
        loanTrack: loanTrack,
        client: {
          dni: dni,
          deletedAt: null,
        },
        deletedAt: null,
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            email: true,
            address: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            totalAmount: true,
            status: true,
            dueDate: true,
            paidDate: true,
            paidAmount: true,
            daysOverdue: true,
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado o DNI no coincide');
    }

    return loan;
  }

  async getAllLoans(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Get loans based on user role and hierarchy
    const loans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        client: {
          managers: {
            some: {
              userId: userId,
              deletedAt: null,
            },
          },
        },
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          select: {
            id: true,
            paymentNumber: true,
            status: true,
            amount: true,
            totalAmount: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.prisma.loan.count({
      where: {
        deletedAt: null,
        client: {
          managers: {
            some: {
              userId: userId,
              deletedAt: null,
            },
          },
        },
      },
    });

    return {
      data: loans,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getLoanById(loanId: string, userId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: {
        id: loanId,
        deletedAt: null,
        client: {
          managers: {
            some: {
              userId: userId,
              deletedAt: null,
            },
          },
        },
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            email: true,
            address: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
        },
        transactions: {
          where: { deletedAt: null },
          orderBy: { transactionDate: 'desc' },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }

    return loan;
  }
} 