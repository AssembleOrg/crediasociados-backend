import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpStatus,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { DailyReportsService } from './daily-reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { SubadminReportDto } from './dto/subadmin-report.dto';
import { DateUtil } from '../common/utils/date.util';

@ApiTags('Daily Reports')
@Controller('daily-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DailyReportsController {
  constructor(private readonly dailyReportsService: DailyReportsService) {}

  @Get('subadmin/managers-report')
  @Roles(UserRole.SUBADMIN)
  @ApiOperation({
    summary: 'Generar reporte PDF de movimientos de managers',
    description:
      'Genera un reporte PDF profesional con todos los movimientos de los managers ' +
      'asociados al subadmin autenticado, dentro del rango de fechas especificado. ' +
      'Solo accesible por el subadmin mismo.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reporte generado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pdfBase64: { type: 'string', description: 'PDF en base64' },
        filename: { type: 'string' },
        error: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Solo los SUBADMIN pueden acceder a este endpoint',
  })
  async getSubadminManagersReport(
    @CurrentUser() currentUser: any,
    @Query() query: SubadminReportDto,
    @Res() res: Response,
  ) {
    // Validar que el usuario es SUBADMIN
    if (currentUser.role !== UserRole.SUBADMIN) {
      throw new ForbiddenException(
        'Solo los SUBADMIN pueden acceder a este endpoint',
      );
    }

    // Validar que las fechas son válidas
    const startDate = DateUtil.parseToDate(query.startDate);
    const endDate = DateUtil.parseToDate(query.endDate);

    if (startDate > endDate) {
      throw new ForbiddenException(
        'La fecha de inicio debe ser anterior a la fecha de fin',
      );
    }

    const result = await this.dailyReportsService.generateSubadminManagersReport(
      currentUser.id,
      query.startDate,
      query.endDate,
    );

    if (!result.success || !result.pdfBase64) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: result.error || 'Error al generar el reporte',
      });
    }

    // Decodificar base64 a buffer
    const pdfBuffer = Buffer.from(result.pdfBase64, 'base64');

    // Configurar headers para descarga de PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    // Enviar el PDF
    return res.send(pdfBuffer);
  }
}

