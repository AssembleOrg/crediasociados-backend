import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, ChangePasswordDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Request, Response } from 'express';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieIsSecure = process.env.NODE_ENV === 'production';
  private readonly accessTokenCookieName = 'access_token';
  private readonly refreshTokenCookieName = 'refresh_token';

  constructor(
    private readonly authService: AuthService,
    private readonly logger: Logger,
  ) {}

  private setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    response.cookie(this.accessTokenCookieName, accessToken, {
      httpOnly: true,
      secure: this.cookieIsSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000, // 15m
    });

    response.cookie(this.refreshTokenCookieName, refreshToken, {
      httpOnly: true,
      secure: this.cookieIsSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
    });
  }

  private clearAuthCookies(response: Response) {
    response.clearCookie(this.accessTokenCookieName, {
      httpOnly: true,
      secure: this.cookieIsSecure,
      sameSite: 'lax',
      path: '/',
    });
    response.clearCookie(this.refreshTokenCookieName, {
      httpOnly: true,
      secure: this.cookieIsSecure,
      sameSite: 'lax',
      path: '/',
    });
  }

  @Public()
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 login attempts per minute per IP
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.log(`Login attempt for user ${loginDto.email}`);
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new BadRequestException('El email o la contraseña son incorrectos');
    }
    const authResult = await this.authService.login(user);
    this.setAuthCookies(
      response,
      authResult.accessToken,
      authResult.refreshToken,
    );

    return { user: authResult.user };
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 refresh attempts per minute per IP
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar token de acceso' })
  @ApiResponse({ status: 200, description: 'Token actualizado exitosamente' })
  @ApiResponse({ status: 401, description: 'Token de actualización inválido' })
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshTokenFromCookie = request.cookies?.[this.refreshTokenCookieName];
    const refreshToken = refreshTokenFromCookie || refreshTokenDto.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Refresh token requerido');
    }

    const authResult = await this.authService.refreshToken(refreshToken);
    this.setAuthCookies(
      response,
      authResult.accessToken,
      authResult.refreshToken,
    );

    return { ok: true };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cierre de sesión' })
  @ApiResponse({ status: 200, description: 'Cierre de sesión exitoso' })
  async logout(
    @CurrentUser() user: any,
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshTokenFromCookie = request.cookies?.[this.refreshTokenCookieName];
    const refreshToken = refreshTokenFromCookie || refreshTokenDto.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearAuthCookies(response);
    return { message: 'Cierre de sesión exitoso' };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar contraseña del usuario actual' })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada exitosamente' })
  @ApiResponse({ status: 400, description: 'Contraseña actual incorrecta' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }
}
