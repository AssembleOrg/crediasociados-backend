import { PrismaService } from '../../prisma/prisma.service';

export class TrackingCodeUtil {
  /**
   * Genera un código de tracking único usando secuencias atómicas
   * Formato: {PREFIX}-{YEAR}-{SEQUENTIAL} (ej: CREDITO-2024-001)
   * 
   * Este método es a prueba de concurrencia usando transacciones atómicas
   */
  static async generateSequentialTrackingCode(
    prisma: PrismaService, 
    prefix: string = 'CREDITO'
  ): Promise<{ trackingCode: string; prefix: string; year: number; sequence: number }> {
    const currentYear = new Date().getFullYear();
    
    // Usar transacción atómica para generar la secuencia
    const result = await prisma.$transaction(async (tx) => {
      // Crear o tomar el contador de secuencia
      const seqRow = await tx.loanSequence.upsert({
        where: { 
          prefix_year: { 
            prefix, 
            year: currentYear 
          } 
        },
        create: { 
          prefix, 
          year: currentYear, 
          next: 2 
        },        // Reservará el 1
        update: { 
          next: { increment: 1 } 
        },       // Siguiente número
        select: { next: true },
      });

      const sequence = seqRow.next - 1; // El número que acabamos de reservar
      const formattedSequence = sequence.toString().padStart(5, '0');
      const trackingCode = `${prefix}-${currentYear}-${formattedSequence}`;

      return {
        trackingCode,
        prefix,
        year: currentYear,
        sequence
      };
    });

    return result;
  }

  /**
   * Genera un código de tracking único para casos especiales
   * Formato: CREDI-ASOCIADOS-{TIMESTAMP}-{RANDOM_SUFFIX}
   * 
   * Solo usar cuando la secuencia secuencial no sea apropiada
   */
  static async generateUniqueTrackingCode(prisma: PrismaService): Promise<string> {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    let trackingCode = `CREDI-ASOCIADOS-${timestamp}-${randomSuffix}`;
    
    // Verificar que el código sea único
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      const existingLoan = await prisma.loan.findUnique({
        where: { loanTrack: trackingCode },
      });
      
      if (!existingLoan) {
        return trackingCode;
      }
      
      // Si existe, generar uno nuevo
      const newTimestamp = Date.now();
      const newRandomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
      trackingCode = `CREDI-ASOCIADOS-${newTimestamp}-${newRandomSuffix}`;
      attempts++;
    }
    
    // Si después de 10 intentos no se encuentra uno único, usar timestamp más específico
    const finalTimestamp = Date.now();
    const finalRandomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `CREDI-ASOCIADOS-${finalTimestamp}-${finalRandomSuffix}`;
  }
} 