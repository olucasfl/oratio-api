import { Body, Controller, Post, Get, Query, Res, Req, Headers, HttpCode, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from "express";
import { AuthService } from './auth.service';
import { getClientIp } from './utils/session-info.util';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {

  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService
  ) {}

  /*
  Login, forgot-password e resend-verification são as rotas mais
  visadas pra brute-force/spam — limite mais apertado que o resto
  do controller (10/min, definido no ThrottlerModule do AuthModule).
  */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() body: LoginDto, @Req() req: any) {
    return this.authService.login(body.email, body.password, {
      userAgent: req.headers['user-agent'],
      ipAddress: getClientIp(req),
    });
  }

  /*
  Login com Google. Pública, como /login (que também não confere x-app —
  só POST /users confere). Throttle 5/min por paridade com o /login, mas o
  alvo aqui é abuso genérico, não força bruta: não há senha pra adivinhar,
  o `credential` só passa se o Google o assinou.

  Responde 200 (não o 201 default do Nest): descreve melhor "sessão emitida".
  O /login continua 201 por outro motivo — ver ARCHITECTURE §8.
  */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('google')
  loginWithGoogle(@Body() body: GoogleLoginDto, @Req() req: any) {
    return this.authService.loginWithGoogle(body.credential, {
      userAgent: req.headers['user-agent'],
      ipAddress: getClientIp(req),
    });
  }

  @Post('refresh')
    refresh(@Body() body: RefreshTokenDto) {
      return this.authService.refresh(body.refresh_token);
    }

  /*
  Revoga a sessão desse refresh token especificamente — as outras
  sessões/dispositivos do usuário continuam ativos. Best-effort: não
  lança erro se o token já não for válido, o logout do lado do
  cliente não deve travar por causa disso.
  */
  @Post('logout')
  async logout(@Body() body: RefreshTokenDto) {
    await this.authService.logout(body.refresh_token);
    return { message: 'Logged out' };
  }

  @Get("verify-email")
  verifyEmail(@Query("token") token: string, @Query("app") app: string, @Res() res: Response) {
    return this.authService.verifyEmail(token, app, res);
  }

  /*
  Usado pelo frontend do Oratio: a página /verificar-email chama essa
  rota via fetch/axios depois de carregada, em vez de o link do email
  navegar direto pra cá. Isso evita que o pré-carregamento automático de
  link do Mail/Safari (que só segue navegação/GET de página, não dispara
  chamadas de API feitas por JS) consuma o token antes do clique real.
  */
  @Post('verify-email')
  confirmEmail(@Body() body: VerifyEmailDto) {
    return this.authService.confirmEmailToken(body.token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  resendVerification(@Body() body: ResendVerificationDto, @Headers('x-app') app?: string) {
    return this.authService.resendVerification(body.email, app);
  }

  /*
  Limite mais alto que o padrão (30/min) em vez de isento: o frontend
  faz polling nessa rota a cada 3s enquanto espera a confirmação do
  email (ver VerifyEmailModal no Oratio) — isso já dá ~20/min de uso
  legítimo, então 30/min cobre com folga sem deixar a rota totalmente
  livre pra alguém varrer emails em sequência sem limite nenhum. A
  resposta em si já não vaza se a conta existe (retorna `false` tanto
  pra "não existe" quanto pra "existe mas não verificado").
  */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get("check-verification")
  checkVerification(@Query("email") email: string) {
    return this.authService.checkVerification(email);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("forgot-password")
  forgotPassword(@Body() body: ForgotPasswordDto, @Headers('x-app') app?: string) {
    return this.authService.requestPasswordReset(body.email, app);
  }

  @Post("reset-password")
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.password);
  }

  /*
  Confirmação de troca de email. Pública (o clique vem de um link de
  email, pode não ter sessão válida nesse navegador) — o frontend
  chama essa rota via fetch depois de carregar a página, nunca por
  navegação GET direta.
  */
  @Post('verify-email-change')
  confirmEmailChange(@Body() body: VerifyEmailDto) {
    return this.authService.confirmEmailChange(body.token);
  }

}