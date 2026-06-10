import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DateTime } from 'luxon';
import { DateUtil } from '../common/utils';
import * as PDFDocument from 'pdfkit';

@Injectable()
export class LoanPdfService {
  constructor(private prisma: PrismaService) {}

  private formatCurrency(amount: number, currency: string): string {
    const symbol = currency === 'USD' ? 'US$' : '$';
    return `${symbol}${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private formatDate(date: Date): string {
    return DateUtil.fromPrismaDate(date).toFormat('dd/MM/yyyy');
  }

  private frequencyLabel(freq: string): string {
    const map: Record<string, string> = {
      DAILY: 'Diaria',
      WEEKLY: 'Semanal',
      BIWEEKLY: 'Quincenal',
      MONTHLY: 'Mensual',
    };
    return map[freq] || freq;
  }

  async generateLoanPdf(
    loanId: string,
  ): Promise<{ pdfBase64: string; filename: string }> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        client: {
          select: {
            fullName: true,
            dni: true,
            cuit: true,
            phone: true,
            address: true,
          },
        },
        subLoans: {
          where: { deletedAt: null },
          orderBy: { paymentNumber: 'asc' },
          select: {
            paymentNumber: true,
            totalAmount: true,
            dueDate: true,
          },
        },
      },
    });

    if (!loan) throw new NotFoundException('Préstamo no encontrado');

    const manager = loan.managerId
      ? await this.prisma.user.findUnique({
          where: { id: loan.managerId },
          select: { fullName: true, email: true },
        })
      : null;

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 40, right: 40 },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            pdfBase64: buffer.toString('base64'),
            filename: `prestamo-${loan.loanTrack}.pdf`,
          });
        });
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - 80;
        const currency = loan.currency;

        // Header band
        doc.rect(0, 0, pageWidth, 90).fillColor('#2c3e50').fill();
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(22)
          .text('COMPROBANTE DE PRÉSTAMO', 40, 28, { align: 'left' });
        doc
          .font('Helvetica')
          .fontSize(12)
          .fillColor('#ecf0f1')
          .text(`Código: ${loan.loanTrack}`, 40, 58);
        doc
          .fontSize(10)
          .fillColor('#bdc3c7')
          .text(
            `Emitido: ${DateTime.now()
              .setZone('America/Argentina/Buenos_Aires')
              .toFormat('dd/MM/yyyy HH:mm')} hs`,
            40,
            74,
          );

        doc.y = 110;
        doc.fillColor('#2c3e50');

        // Cliente
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .text('DATOS DEL CLIENTE', 40, doc.y);
        doc
          .moveTo(40, doc.y + 2)
          .lineTo(pageWidth - 40, doc.y + 2)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.6);

        doc.font('Helvetica').fontSize(10).fillColor('#2c3e50');
        const clientRows: [string, string][] = [
          ['Nombre', loan.client.fullName || '-'],
          ['DNI', loan.client.dni || '-'],
          ['CUIT', loan.client.cuit || '-'],
          ['Teléfono', loan.client.phone || '-'],
          ['Dirección', loan.client.address || '-'],
        ];
        clientRows.forEach(([label, value]) => {
          doc.font('Helvetica-Bold').text(`${label}: `, 40, doc.y, {
            continued: true,
            width: contentWidth,
          });
          doc.font('Helvetica').text(value);
        });

        doc.moveDown(0.8);

        // Manager
        if (manager) {
          doc
            .font('Helvetica-Bold')
            .fontSize(13)
            .text('OTORGADO POR', 40, doc.y);
          doc
            .moveTo(40, doc.y + 2)
            .lineTo(pageWidth - 40, doc.y + 2)
            .strokeColor('#cccccc')
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.6);
          doc.font('Helvetica').fontSize(10);
          doc.font('Helvetica-Bold').text('Manager: ', 40, doc.y, {
            continued: true,
          });
          doc
            .font('Helvetica')
            .text(manager.fullName || manager.email);
          doc.moveDown(0.8);
        }

        // Términos del préstamo
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .fillColor('#2c3e50')
          .text('TÉRMINOS DEL PRÉSTAMO', 40, doc.y);
        doc
          .moveTo(40, doc.y + 2)
          .lineTo(pageWidth - 40, doc.y + 2)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.6);

        const original = Number(loan.originalAmount);
        const total = Number(loan.amount);
        const interest = Number(loan.baseInterestRate);
        const termRows: [string, string][] = [
          ['Capital prestado', this.formatCurrency(original, currency)],
          ['Tasa de interés', `${(interest * 100).toFixed(2)}%`],
          ['Total a devolver', this.formatCurrency(total, currency)],
          ['Cantidad de cuotas', String(loan.totalPayments)],
          ['Frecuencia', this.frequencyLabel(loan.paymentFrequency)],
          [
            'Primer vencimiento',
            loan.firstDueDate ? this.formatDate(loan.firstDueDate) : '-',
          ],
          ['Moneda', currency],
        ];

        doc.font('Helvetica').fontSize(10);
        termRows.forEach(([label, value]) => {
          doc.font('Helvetica-Bold').text(`${label}: `, 40, doc.y, {
            continued: true,
          });
          doc.font('Helvetica').text(value);
        });

        doc.moveDown(1);

        // Cronograma de cuotas
        if (doc.y > doc.page.height - 200) doc.addPage();

        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .fillColor('#2c3e50')
          .text('CRONOGRAMA DE CUOTAS', 40, doc.y);
        doc
          .moveTo(40, doc.y + 2)
          .lineTo(pageWidth - 40, doc.y + 2)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.5);

        const colX = [40, 100, 260];
        const colW = [60, 160, contentWidth - 60 - 160];
        const rowH = 20;

        // Encabezado tabla
        const headerY = doc.y;
        doc.rect(40, headerY, contentWidth, rowH).fillColor('#34495e').fill();
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('#', colX[0] + 6, headerY + 6, { width: colW[0] })
          .text('Vencimiento', colX[1] + 6, headerY + 6, { width: colW[1] })
          .text('Monto', colX[2] + 6, headerY + 6, {
            width: colW[2] - 12,
            align: 'right',
          });
        doc.y = headerY + rowH;

        doc.font('Helvetica').fontSize(10).fillColor('#2c3e50');
        loan.subLoans.forEach((sl, idx) => {
          if (doc.y > doc.page.height - 60) {
            doc.addPage();
            doc.y = 60;
          }
          const rowY = doc.y;
          if (idx % 2 === 0) {
            doc.rect(40, rowY, contentWidth, rowH).fillColor('#f6f8fa').fill();
          }
          doc
            .fillColor('#2c3e50')
            .text(String(sl.paymentNumber), colX[0] + 6, rowY + 6, {
              width: colW[0],
            })
            .text(this.formatDate(sl.dueDate), colX[1] + 6, rowY + 6, {
              width: colW[1],
            })
            .text(
              this.formatCurrency(Number(sl.totalAmount), currency),
              colX[2] + 6,
              rowY + 6,
              { width: colW[2] - 12, align: 'right' },
            );
          doc.y = rowY + rowH;
        });

        // Footer
        doc
          .fontSize(8)
          .fillColor('#888888')
          .text(
            `Documento generado por Crediasociados · ${loan.loanTrack}`,
            40,
            doc.page.height - 35,
            { align: 'center', width: contentWidth },
          );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
