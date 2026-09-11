import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';

const TZ = 'America/Argentina/Buenos_Aires';

// Paleta compartida con loan-pdf.service y daily-reports.service
const COLORS = {
  band: '#2c3e50',
  bandText: '#ffffff',
  bandSub: '#ecf0f1',
  bandMuted: '#bdc3c7',
  text: '#2c3e50',
  muted: '#7f8c8d',
  line: '#cccccc',
  tableHead: '#34495e',
  rowAlt: '#f6f8fa',
  green: '#27ae60',
  red: '#e74c3c',
  blue: '#3498db',
  orange: '#e67e22',
  purple: '#9b59b6',
  footer: '#888888',
};

type TxType =
  | 'COLLECTION'
  | 'WITHDRAWAL'
  | 'ROUTE_EXPENSE'
  | 'LOAN_DISBURSEMENT'
  | 'CASH_ADJUSTMENT'
  | 'PAYMENT_RESET'
  | string;

@Injectable()
export class CollectorReportPdfService {
  /**
   * Genera el PDF del reporte de período de un cobrador.
   * Recibe el mismo objeto que devuelve CollectorWalletService.getPeriodReport.
   */
  async generatePeriodReportPdf(
    report: any,
  ): Promise<{ pdfBase64: string; filename: string }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 40, right: 40 },
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            pdfBase64: buffer.toString('base64'),
            filename: this.buildFilename(report),
          });
        });
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const left = 40;
        const contentWidth = pageWidth - 80;
        const bottomLimit = pageHeight - 70;

        const startDt = DateTime.fromISO(report.period?.startDate).setZone(TZ);
        const endDt = DateTime.fromISO(report.period?.endDate).setZone(TZ);
        const fmtDate = (d: DateTime) => (d.isValid ? d.toFormat('dd/MM/yyyy') : '-');
        const fmtDateTime = (iso: string | Date) => {
          const d =
            iso instanceof Date
              ? DateTime.fromJSDate(iso).setZone(TZ)
              : DateTime.fromISO(String(iso)).setZone(TZ);
          return d.isValid ? d.toFormat('dd/MM/yyyy HH:mm') : '-';
        };
        const money = (n: number) =>
          `$${Number(n || 0).toLocaleString('es-AR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`;

        // ── Helpers de layout ──────────────────────────────────────────────
        // Trunca con "…" para que entre en una sola línea (usa la fuente activa)
        const fitText = (text: string, width: number): string => {
          const str = String(text ?? '');
          if (doc.widthOfString(str) <= width) return str;
          let cut = str;
          while (cut.length > 0 && doc.widthOfString(`${cut}…`) > width) {
            cut = cut.slice(0, -1);
          }
          return `${cut.trimEnd()}…`;
        };

        const ensureSpace = (needed: number) => {
          if (doc.y + needed > bottomLimit) {
            doc.addPage();
            doc.y = 50;
          }
        };

        const sectionHeader = (title: string) => {
          ensureSpace(40);
          doc
            .font('Helvetica-Bold')
            .fontSize(13)
            .fillColor(COLORS.text)
            .text(title, left, doc.y);
          doc
            .moveTo(left, doc.y + 2)
            .lineTo(pageWidth - 40, doc.y + 2)
            .strokeColor(COLORS.line)
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.6);
        };

        const keyValueRows = (rows: [string, string][], cols = 2) => {
          const colWidth = contentWidth / cols;
          const rowH = 16;
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
          for (let i = 0; i < rows.length; i += cols) {
            ensureSpace(rowH);
            const y = doc.y;
            for (let c = 0; c < cols; c++) {
              const row = rows[i + c];
              if (!row) continue;
              const x = left + c * colWidth;
              doc.font('Helvetica-Bold').text(`${row[0]}: `, x, y, {
                continued: true,
                width: colWidth - 8,
              });
              doc.font('Helvetica').text(row[1]);
            }
            doc.y = y + rowH;
          }
          doc.moveDown(0.6);
        };

        /**
         * Tabla con encabezado oscuro y filas alternadas.
         * cols: { label, width (fracción de contentWidth), align }
         * rows: celdas ya formateadas; opcionalmente color por celda.
         */
        const table = (
          cols: { label: string; width: number; align?: 'left' | 'right' | 'center' }[],
          rows: { cells: string[]; colors?: (string | undefined)[]; bold?: boolean }[],
          opts: { emptyText?: string } = {},
        ) => {
          const rowH = 20;
          const pad = 6;
          const widths = cols.map((c) => c.width * contentWidth);

          const drawHead = () => {
            ensureSpace(rowH * 2);
            const y = doc.y;
            doc.rect(left, y, contentWidth, rowH).fillColor(COLORS.tableHead).fill();
            doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.bandText);
            let x = left;
            cols.forEach((c, i) => {
              const w = widths[i] - pad * 2;
              doc.text(fitText(c.label, w), x + pad, y + 6, {
                width: w,
                align: c.align || 'left',
                lineBreak: false,
              });
              x += widths[i];
            });
            doc.y = y + rowH;
          };

          drawHead();

          if (rows.length === 0) {
            doc
              .font('Helvetica')
              .fontSize(9)
              .fillColor(COLORS.muted)
              .text(opts.emptyText || 'Sin registros en el período', left + pad, doc.y + 6);
            doc.y += rowH;
            doc.moveDown(0.6);
            return;
          }

          rows.forEach((row, idx) => {
            if (doc.y + rowH > bottomLimit) {
              doc.addPage();
              doc.y = 50;
              drawHead();
            }
            const y = doc.y;
            if (idx % 2 === 0) {
              doc.rect(left, y, contentWidth, rowH).fillColor(COLORS.rowAlt).fill();
            }
            let x = left;
            row.cells.forEach((cell, i) => {
              const w = widths[i] - pad * 2;
              doc
                .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(9)
                .fillColor(row.colors?.[i] || COLORS.text);
              doc.text(fitText(cell, w), x + pad, y + 6, {
                width: w,
                align: cols[i].align || 'left',
                lineBreak: false,
              });
              x += widths[i];
            });
            doc.y = y + rowH;
          });
          doc.moveDown(0.8);
        };

        // ── Header band ────────────────────────────────────────────────────
        doc.rect(0, 0, pageWidth, 90).fillColor(COLORS.band).fill();
        doc
          .fillColor(COLORS.bandText)
          .font('Helvetica-Bold')
          .fontSize(22)
          .text('REPORTE DE COBRADOR', left, 28, { align: 'left' });
        doc
          .font('Helvetica')
          .fontSize(12)
          .fillColor(COLORS.bandSub)
          .text(
            `${report.collector?.fullName || 'Cobrador'}  ·  ${fmtDate(startDt)} - ${fmtDate(endDt)}`,
            left,
            58,
          );
        doc
          .fontSize(10)
          .fillColor(COLORS.bandMuted)
          .text(
            `Emitido: ${DateTime.now().setZone(TZ).toFormat('dd/MM/yyyy HH:mm')} hs`,
            left,
            74,
          );

        doc.y = 110;

        // ── Datos del cobrador ─────────────────────────────────────────────
        sectionHeader('DATOS DEL COBRADOR');
        keyValueRows([
          ['Nombre', report.collector?.fullName || '-'],
          ['Usuario', report.collector?.userId || '-'],
          ['Rol', report.collector?.role || '-'],
          ['Comisión', `${report.collector?.commissionPercentage ?? 0}%`],
          ['Desde', fmtDate(startDt)],
          ['Hasta', fmtDate(endDt)],
        ]);

        // ── Resumen del período ───────────────────────────────────────────
        const cobrado = Number(report.cobrado ?? report.summary?.cobrado ?? 0);
        const prestado = Number(report.prestado ?? report.summary?.prestado ?? 0);
        const gastado = Number(report.gastado ?? report.summary?.gastado ?? 0);
        const retirado = Number(report.retirado ?? report.summary?.retirado ?? 0);
        const ajusteCaja = Number(report.ajusteCaja ?? report.summary?.ajusteCaja ?? 0);
        const netoConAjuste = Number(report.neto ?? report.summary?.neto ?? 0);
        const netoSinAjuste = netoConAjuste - ajusteCaja;
        const commissionPct = report.commission?.percentage ?? 0;
        const commissionAmount = Number(report.commission?.commissionAmount ?? 0);

        sectionHeader('RESUMEN DEL PERÍODO');
        table(
          [
            { label: 'Concepto', width: 0.6 },
            { label: 'Monto', width: 0.4, align: 'right' },
          ],
          [
            { cells: ['Cobrado', money(cobrado)], colors: [undefined, COLORS.green], bold: true },
            { cells: ['Prestado', money(prestado)], colors: [undefined, COLORS.blue], bold: true },
            { cells: ['Gastado', money(gastado)], colors: [undefined, COLORS.red], bold: true },
            { cells: ['Retirado', money(retirado)], colors: [undefined, COLORS.orange], bold: true },
            { cells: ['Ajuste de Caja', money(ajusteCaja)], colors: [undefined, COLORS.blue], bold: true },
            { cells: ['Neto (con ajuste)', money(netoConAjuste)], colors: [undefined, COLORS.text], bold: true },
            {
              cells: ['Neto (sin ajuste)', money(netoSinAjuste)],
              colors: [undefined, netoSinAjuste >= 0 ? COLORS.text : COLORS.red],
              bold: true,
            },
            {
              cells: [`Comisión (${commissionPct}%)`, money(commissionAmount)],
              colors: [undefined, COLORS.purple],
              bold: true,
            },
          ],
        );

        // ── Estadísticas de cobros ────────────────────────────────────────
        const col = report.collections || {};
        const pct = col.percentages || {};
        const amounts = col.amounts || {};
        sectionHeader('ESTADÍSTICAS DE COBROS');
        table(
          [
            { label: 'Indicador', width: 0.5 },
            { label: 'Cantidad', width: 0.25, align: 'right' },
            { label: '%', width: 0.25, align: 'right' },
          ],
          [
            { cells: ['Cuotas a cobrar', String(col.totalDue ?? 0), '100%'] },
            {
              cells: ['Cobradas completas', String(col.collected?.full ?? 0), `${pct.full ?? 0}%`],
              colors: [undefined, COLORS.green, COLORS.green],
            },
            {
              cells: ['Cobradas parciales', String(col.collected?.partial ?? 0), `${pct.partial ?? 0}%`],
              colors: [undefined, COLORS.orange, COLORS.orange],
            },
            {
              cells: ['No cobradas', String(col.failed ?? 0), `${pct.failed ?? 0}%`],
              colors: [undefined, COLORS.red, COLORS.red],
            },
          ],
        );
        keyValueRows([
          ['Monto a cobrar', money(amounts.totalDue ?? 0)],
          ['Monto cobrado', money(amounts.totalCollected ?? 0)],
        ]);

        // ── Gastos por categoría ──────────────────────────────────────────
        const byCategory: Record<string, number> = report.expenses?.byCategory || {};
        const expenseRows = Object.entries(byCategory).map(([cat, amt]) => ({
          cells: [cat, money(Number(amt))],
          colors: [undefined, COLORS.red],
        }));
        if (expenseRows.length > 0) {
          sectionHeader('GASTOS POR CATEGORÍA');
          table(
            [
              { label: 'Categoría', width: 0.6 },
              { label: 'Monto', width: 0.4, align: 'right' },
            ],
            expenseRows,
          );
        }

        // ── Movimientos de la wallet de cobros ────────────────────────────
        const txs: any[] = report.collectorWallet?.transactions || [];
        sectionHeader(`MOVIMIENTOS DE WALLET DE COBROS (${txs.length})`);
        table(
          [
            { label: 'Fecha', width: 0.16 },
            { label: 'Tipo', width: 0.16 },
            { label: 'Descripción', width: 0.4 },
            { label: 'Monto', width: 0.14, align: 'right' },
            { label: 'Saldo', width: 0.14, align: 'right' },
          ],
          txs.map((t) => {
            const amount = Number(t.amount);
            return {
              cells: [
                fmtDateTime(t.createdAt),
                this.txLabel(t.type, amount),
                t.description || '-',
                `${this.txSign(t.type, amount)}${money(Math.abs(amount))}`,
                money(t.balanceAfter),
              ],
              colors: [undefined, undefined, undefined, this.txColor(t.type, amount), COLORS.muted],
            };
          }),
          { emptyText: 'Sin movimientos en el período' },
        );

        // ── Footer en todas las páginas ───────────────────────────────────
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          // Sin margen inferior: evita que pdfkit agregue una página al escribir el pie
          doc.page.margins.bottom = 0;
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(COLORS.footer)
            .text(
              `CrediAsociados · Reporte de cobrador · Página ${i - range.start + 1} de ${range.count}`,
              left,
              pageHeight - 40,
              { width: contentWidth, align: 'center', lineBreak: false },
            );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private buildFilename(report: any): string {
    const slug = String(report.collector?.fullName || 'cobrador')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const start = DateTime.fromISO(report.period?.startDate).setZone(TZ);
    const end = DateTime.fromISO(report.period?.endDate).setZone(TZ);
    const s = start.isValid ? start.toFormat('yyyy-MM-dd') : 'inicio';
    const e = end.isValid ? end.toFormat('yyyy-MM-dd') : 'fin';
    return `reporte-cobrador-${slug}-${s}_${e}.pdf`;
  }

  // Mismo mapeo que CollectorReportView del frontend
  private txLabel(type: TxType, amount: number): string {
    switch (type) {
      case 'COLLECTION':
        return 'Cobro';
      case 'WITHDRAWAL':
        return 'Retiro';
      case 'ROUTE_EXPENSE':
        return 'Gasto de Ruta';
      case 'LOAN_DISBURSEMENT':
        return 'Desembolso';
      case 'CASH_ADJUSTMENT':
        return amount < 0 ? '- Ajuste de Caja' : 'Ajuste de Caja';
      case 'PAYMENT_RESET':
        return 'Reseteo de pago';
      default:
        return 'Transacción';
    }
  }

  private txSign(type: TxType, amount: number): string {
    if (type === 'CASH_ADJUSTMENT') return amount < 0 ? '-' : '+';
    if (type === 'COLLECTION') return '+';
    return '-';
  }

  private txColor(type: TxType, amount: number): string {
    if (type === 'CASH_ADJUSTMENT') return amount < 0 ? COLORS.red : COLORS.blue;
    if (type === 'COLLECTION') return COLORS.green;
    return COLORS.red;
  }
}
