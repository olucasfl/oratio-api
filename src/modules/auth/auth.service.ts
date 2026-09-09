import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { MailService } from '../mail/mail.service';
import { Response } from 'express';
import { AppType } from 'src/enums/app-type.enum';
import { parseDeviceLabel, resolveLocation } from './utils/session-info.util';

export interface DeviceInfo {
  userAgent?: string;
  ipAddress?: string;
}

/*
Resultado do POST /auth/google. Além do par de tokens (mesmo shape do login),
dois booleanos que dizem ao frontend O QUE aconteceu nesta requisição
(spec login-google §"Fase E → E2"):
  - isNewUser        -> um User foi CRIADO agora (cadastro via Google)
  - googleLinkedNow  -> um LinkedAccount foi criado agora para um User que JÁ
                        existia (auto-ligação)
Login recorrente (o LinkedAccount já existia) = os dois false. Nunca os dois
true. Consumidores: tela de boas-vindas (isNewUser), toast de auto-ligação
(googleLinkedNow), bloqueio de cadastro repetido na tela /register (isNewUser).
Só chega junto com um par de tokens válido — não é vazamento.
*/
export interface GoogleLoginResult {
  access_token: string;
  refresh_token: string;
  isNewUser: boolean;
  googleLinkedNow: boolean;
}

@Injectable()
export class AuthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  /*
  Secret exclusivo do refresh token — diferente do JWT_SECRET_KEY usado
  pelo access token. Assim, um refresh token vazado não pode ser usado
  como Bearer em rotas protegidas (a assinatura simplesmente não bate
  com o secret que o JwtStrategy usa pra validar access tokens).
  */
  private getRefreshSecret(): string {

    const secret = process.env.JWT_REFRESH_SECRET;

    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET não configurada no ambiente');
    }

    return secret;

  }

  /*
  Hash do refresh token pra guardar no banco. Propositalmente NÃO usa
  bcrypt aqui: bcrypt trunca a entrada em 72 bytes, e como todo refresh
  token do mesmo usuário começa com o mesmo prefixo (header fixo + sub +
  email, antes de iat/exp no payload do JWT), tokens *diferentes* do
  mesmo usuário podiam colidir no hash truncado — ou seja, um token já
  rotacionado continuava "válido" contra o hash de outro. Bcrypt é pra
  segredo de baixa entropia (senha); um JWT assinado já é de altíssima
  entropia, então um hash rápido (SHA-256) resolve certo, sem o limite
  de tamanho, e ainda permite lookup direto por hash em vez de comparar
  um por um contra cada sessão.
  */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(email: string, password: string, deviceInfo?: DeviceInfo) {

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    /*
    Conta só-Google (criada por login social, sem senha). Responde 401 com
    mensagem ESPECÍFICA — decisão da Fase E, revertendo o erro genérico da
    Fase A (spec login-google §"Fase E → E1"). Sim, isso revela que a conta
    existe e é só-Google; aceito porque:
      - o app já vaza existência pela MESMA rota ("Please verify your email
        before logging in" só aparece pra conta existente não-verificada);
      - o @Throttle(5/60s) do controller limita varredura em massa;
      - quem bate aqui é quase sempre o dono legítimo que esqueceu o método.
    `bcrypt.compare(x, null)` lançaria, então isto barra antes, como antes.
    Quem quer senha entra pelo Google e usa "Definir senha", ou "esqueci
    minha senha".
    */
    if (!user.password) {
      throw new UnauthorizedException(
        'Esta conta entra com o Google. Use o botão "Continuar com o Google" abaixo.',
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email before logging in');
    }

    return this.generateTokens(user.id, user.email, deviceInfo);

  }

  /*
  =============================
  LOGIN COM GOOGLE
  =============================
  Fluxo: o frontend manda o id_token (JWT) que o Google Identity Services
  entregou no callback do botão. O backend verifica e resolve/cria a conta,
  devolvendo o MESMO par { access_token, refresh_token } do login normal.
  Detalhe em docs/specs/login-google.md.
  */

  private readonly GOOGLE_ISSUERS = [
    'accounts.google.com',
    'https://accounts.google.com',
  ];

  private getGoogleClientId(): string {
    const id = process.env.GOOGLE_CLIENT_ID;
    if (!id) {
      // 503, não 500: é config faltando, não bug. O frontend trata como
      // "indisponível" e mantém o login por senha.
      throw new ServiceUnavailableException(
        'Login com Google indisponível no momento.',
      );
    }
    return id;
  }

  /*
  Verifica o id_token e devolve só o que a resolução de conta precisa.
  `client.verifyIdToken` já valida assinatura (chaves públicas do Google),
  `aud` (== nosso client id), `iss` e `exp`. Reforçamos o `iss` de forma
  explícita (a spec exige) e exigimos `email_verified === true` — essa a lib
  NÃO checa, e sem ela a auto-ligação vira caminho de tomada de conta.
  */
  private async verifyGoogleCredential(
    credential: string,
  ): Promise<{ sub: string; email: string; name: string }> {

    const clientId = this.getGoogleClientId();
    const client = new OAuth2Client(clientId);

    let payload: TokenPayload | undefined;

    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'Não foi possível validar seu login com o Google. Tente de novo.',
      );
    }

    if (
      !payload ||
      !payload.sub ||
      !payload.email ||
      !this.GOOGLE_ISSUERS.includes(payload.iss)
    ) {
      throw new UnauthorizedException(
        'Não foi possível validar seu login com o Google. Tente de novo.',
      );
    }

    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Seu e-mail no Google não está verificado. Confirme seu e-mail na sua Conta Google e tente de novo — ou crie sua conta do Oratio com e-mail e senha.',
      );
    }

    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      // `name` só é usado na CRIAÇÃO da conta (nunca sobrescreve depois).
      // `User.name` é obrigatório no schema; fallback defensivo caso o Google
      // não devolva (não deveria, com o escopo `profile`).
      name: payload.name?.trim() || payload.email.split('@')[0],
    };
  }

  /*
  Reusado pelo `UsersService` para excluir uma conta só-Google: como não há
  senha para confirmar a intenção, a prova de identidade é um id_token fresco
  do Google (mesma verificação do POST /auth/google). Devolve o `sub` para
  casar com um `LinkedAccount` do usuário.
  */
  async verifyGoogleIdentity(credential: string) {
    return this.verifyGoogleCredential(credential);
  }

  // Compõe o resultado do /auth/google: tokens + os flags do desfecho.
  private withGoogleFlags(
    tokens: { access_token: string; refresh_token: string },
    flags: { isNewUser: boolean; googleLinkedNow: boolean },
  ): GoogleLoginResult {
    return { ...tokens, ...flags };
  }

  async loginWithGoogle(
    credential: string,
    deviceInfo?: DeviceInfo,
  ): Promise<GoogleLoginResult> {

    const profile = await this.verifyGoogleCredential(credential);

    // 1. Já existe um vínculo Google para este `sub`? -> login direto.
    const link = await this.prisma.linkedAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: profile.sub,
        },
      },
    });

    if (link) {
      const user = await this.prisma.user.findUnique({
        where: { id: link.userId },
      });
      if (!user) {
        // vínculo órfão (não deveria existir — onDelete Cascade cuida disso)
        throw new UnauthorizedException(
          'Não foi possível validar seu login com o Google. Tente de novo.',
        );
      }
      // login recorrente: o vínculo já existia, nada foi criado agora
      const tokens = await this.generateTokens(user.id, user.email, deviceInfo);
      return this.withGoogleFlags(tokens, {
        isNewUser: false,
        googleLinkedNow: false,
      });
    }

    // 2. Já existe um User com este e-mail? -> auto-ligação.
    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (existing) {
      return this.linkGoogleAndIssue(existing, profile, deviceInfo);
    }

    // 3. Cadastro novo. User + vínculo numa transação pra nunca deixar um
    //    User sem senha e sem vínculo (que não conseguiria logar de jeito
    //    nenhum).
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: profile.name,
            email: profile.email,
            emailVerified: true,
            password: null,
          },
        });
        await tx.linkedAccount.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerAccountId: profile.sub,
            emailSnapshot: profile.email,
          },
        });
        return user;
      });
      // cadastro novo via Google
      const tokens = await this.generateTokens(
        created.id,
        created.email,
        deviceInfo,
      );
      return this.withGoogleFlags(tokens, {
        isNewUser: true,
        googleLinkedNow: false,
      });
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) {
        throw err;
      }
      // Corrida: dois cliques no botão -> duas requisições concorrentes pro
      // mesmo e-mail/sub inédito. A 2ª bate no @@unique. Re-resolve uma vez
      // (agora o vínculo ou o User já existem) em vez de estourar 500.
      return this.resolveGoogleAfterRace(profile, deviceInfo);
    }
  }

  // Sempre chamada quando um LinkedAccount está sendo criado AGORA para um
  // User que já existia -> googleLinkedNow: true, isNewUser: false.
  private async linkGoogleAndIssue(
    user: { id: string; email: string; emailVerified: boolean },
    profile: { sub: string; email: string },
    deviceInfo?: DeviceInfo,
  ): Promise<GoogleLoginResult> {
    try {
      await this.prisma.linkedAccount.create({
        data: {
          userId: user.id,
          provider: 'google',
          providerAccountId: profile.sub,
          emailSnapshot: profile.email,
        },
      });
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) {
        throw err;
      }
      // vínculo criado concorrentemente entre o findUnique e aqui — ok, segue.
    }

    /*
    E-mail verificado na auto-ligação: o Google acabou de comprovar a MESMA
    caixa de e-mail que o nosso link de verificação comprovaria. Sem marcar
    `emailVerified: true` aqui, uma conta que estava com o e-mail não
    verificado fica barrada PARA SEMPRE no login por senha (que exige
    `emailVerified`), inclusive depois de definir uma senha.
    */
    if (!user.emailVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }

    const tokens = await this.generateTokens(user.id, user.email, deviceInfo);
    return this.withGoogleFlags(tokens, {
      isNewUser: false,
      googleLinkedNow: true,
    });
  }

  private async resolveGoogleAfterRace(
    profile: { sub: string; email: string },
    deviceInfo?: DeviceInfo,
  ): Promise<GoogleLoginResult> {
    const link = await this.prisma.linkedAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: profile.sub,
        },
      },
    });

    if (link) {
      const user = await this.prisma.user.findUnique({
        where: { id: link.userId },
      });
      if (user) {
        // o vínculo foi criado pela requisição concorrente, não por esta
        const tokens = await this.generateTokens(
          user.id,
          user.email,
          deviceInfo,
        );
        return this.withGoogleFlags(tokens, {
          isNewUser: false,
          googleLinkedNow: false,
        });
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (user) {
      return this.linkGoogleAndIssue(user, profile, deviceInfo);
    }

    // Os dois sumiram de novo entre uma query e outra — altamente improvável.
    throw new ServiceUnavailableException(
      'Não foi possível concluir o login com o Google. Tente de novo.',
    );
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    );
  }

  private readonly REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 180;

  private signTokenPair(userId: string, email: string) {

    const payload = { sub: userId, email };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refresh_token = this.jwtService.sign(payload, {
      /*
      Longo de propósito: o Oratio funciona como um app, não como uma
      sessão de site — a pessoa não deve precisar logar de novo toda hora.
      Como o refresh token rotaciona a cada uso (um novo é emitido em toda
      renovação), na prática quem abre o app pelo menos 1x nesse período
      nunca vê tela de login de novo.
      */
      expiresIn: '180d',
      secret: this.getRefreshSecret(),
    });

    return { access_token, refresh_token };

  }

  // Só chamado num LOGIN de verdade — cria uma sessão nova (um dispositivo
  // a mais na lista). Renovação de token (refresh()) não passa por aqui.
  async generateTokens(userId: string, email: string, deviceInfo?: DeviceInfo) {

    const { access_token, refresh_token } = this.signTokenPair(userId, email);

    // best-effort, nunca derruba o login se falhar ou demorar
    const location = deviceInfo?.ipAddress
      ? await resolveLocation(deviceInfo.ipAddress)
      : null;

    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: this.hashToken(refresh_token),
        expiresAt: new Date(Date.now() + this.REFRESH_TTL_MS),
        userAgent: deviceInfo?.userAgent,
        deviceLabel: deviceInfo?.userAgent
          ? parseDeviceLabel(deviceInfo.userAgent)
          : undefined,
        ipAddress: deviceInfo?.ipAddress,
        location,
      },
    });

    return {
      access_token,
      refresh_token,
    };

  }

  async refresh(refreshToken: string) {

    let payload: any;

    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const session = await this.prisma.refreshSession.findFirst({
      where: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException();
    }

    const { access_token, refresh_token } = this.signTokenPair(user.id, user.email);

    /*
    Atualiza a MESMA sessão em vez de apagar e criar outra. O access
    token dura só 15min, então o app chama refresh() várias vezes por
    dia pra continuar logado — isso é rotação de token da mesma sessão
    contínua, não um novo dispositivo. Antes disso, cada renovação
    empilhava uma linha nova em RefreshSession, e "sessões ativas" no
    perfil virava uma lista de dezenas de artefatos de renovação em
    vez de mostrar os dispositivos reais.
    */
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        tokenHash: this.hashToken(refresh_token),
        expiresAt: new Date(Date.now() + this.REFRESH_TTL_MS),
      },
    });

    return { access_token, refresh_token };
  }

  /*
  Revoga a sessão do refresh token informado (best-effort — se o token
  já não bater com nenhuma sessão ativa, não há nada a fazer, e isso
  não deve impedir o logout do lado do cliente).
  */
  async logout(refreshToken: string) {

    let payload: any;

    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      return;
    }

    await this.prisma.refreshSession.deleteMany({
      where: {
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
      },
    });

  }

  /*
  Núcleo idempotente da confirmação de email, usado tanto pelo endpoint
  legado (GET, redirect) quanto pelo novo endpoint (POST, JSON) chamado
  via fetch pelo frontend.

  O token NÃO é limpo ao confirmar com sucesso. Isso é proposital: links de
  verificação em email são frequentemente pré-carregados automaticamente
  (proteção de privacidade do Mail/Safari no iOS, scanners antiphishing)
  antes do clique real do usuário. Se o token fosse zerado nessa primeira
  requisição "fantasma", o clique real do usuário cairia em 401 por não
  achar mais o token. Mantendo o token e checando `emailVerified` antes de
  tudo, uma segunda (ou terceira) confirmação do mesmo token é inofensiva
  e sempre responde sucesso.
  */
  async confirmEmailToken(token: string) {

    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
      },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid verification token");
    }

    if (user.emailVerified) {
      return { alreadyVerified: true };
    }

    if (
      user.emailVerificationTokenExpires &&
      user.emailVerificationTokenExpires < new Date()
    ) {
      throw new UnauthorizedException("Verification token expired");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
      },
    });

    return { alreadyVerified: false };

  }

  async verifyEmail(token: string, app: string, res: Response) {

    await this.confirmEmailToken(token);

    if (app === "oratio") {
      return res.redirect("https://oratio-phi.vercel.app/login");
    }

    throw new BadRequestException("Unknown app");
  }

  /*
  Confirmação de troca de email — mesmo desenho idempotente do
  confirmEmailToken (token não é limpo no sucesso, checagem de "já
  aplicado" via comparação de estado). O link é enviado só pro
  frontend (nunca direto pra API), então não corre o mesmo risco de
  link prefetching que a verificação original tinha.
  */
  async confirmEmailChange(token: string) {

    const user = await this.prisma.user.findFirst({
      where: { pendingEmailToken: token },
    });

    if (!user || !user.pendingEmail) {
      throw new UnauthorizedException('Invalid confirmation token');
    }

    if (user.email === user.pendingEmail) {
      return { alreadyConfirmed: true, email: user.email };
    }

    if (user.pendingEmailExpires && user.pendingEmailExpires < new Date()) {
      throw new UnauthorizedException('Confirmation link expired');
    }

    const taken = await this.prisma.user.findFirst({
      where: { email: user.pendingEmail, id: { not: user.id } },
    });

    if (taken) {
      throw new ConflictException('This email is no longer available');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { email: user.pendingEmail },
    });

    return { alreadyConfirmed: false, email: user.pendingEmail };

  }

  async resendVerification(email: string, app?: string) {

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return { message: 'If this email exists, a verification email was sent.' };
    }

    if (user.emailVerified) {
      return { message: 'Email already verified.' };
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: token,
        emailVerificationTokenExpires: expires,
      },
    });

    if (app !== AppType.ORATIO) {
      throw new BadRequestException('Unknown or missing app');
    }

    const emailSent = await this.mailService.sendOratioVerificationEmail(user.email, token);

    /*
    Diferente do forgot-password, essa rota já não é "genérica não
    importa o quê" — a essa altura já sabemos que a conta existe e não
    está verificada (branches acima), então não tem segredo de
    existência sendo protegido aqui. Faz sentido avisar de verdade se
    o envio falhou, em vez de mentir "reenviado com sucesso".
    */
    if (!emailSent) {
      throw new ServiceUnavailableException(
        'Failed to send verification email. Please try again in a moment.',
      );
    }

    return {
      message: 'Verification email resent successfully',
    };

  }

  async checkVerification(email: string) {

  const user = await this.prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  return {
    verified: user?.emailVerified || false
  };

}

async requestPasswordReset(email: string, app?: string) {

  const user = await this.prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  /*
  Silencioso nos dois casos (email não existe OU app não reconhecido) —
  de propósito, pra não dar nenhum sinal que deixe alguém descobrir se
  um email existe na base testando variações do header x-app.
  */
  if (!user) return;
  if (app !== AppType.ORATIO) return;

  const token = randomBytes(32).toString("hex");

  const expires = new Date(Date.now() + 1000 * 60 * 30);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: token,
      passwordResetExpires: expires
    }
  });

  await this.mailService.sendOratioPasswordResetEmail(user.email, token);

}

async resetPassword(token: string, password: string) {

  const user = await this.prisma.user.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpires: {
        gt: new Date()
      }
    }
  });

  if (!user) {
    throw new UnauthorizedException("Invalid or expired token");
  }

  const hashed = await bcrypt.hash(password, 10);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      passwordResetToken: null,
      passwordResetExpires: null
    }
  });

  /*
  Reset de senha é o fluxo usado justamente quando a conta pode estar
  comprometida — sem derrubar as sessões existentes, um refresh_token já
  vazado continuaria válido por até 180 dias mesmo depois da troca de
  senha, esvaziando o propósito de segurança do reset. Mesma lógica já
  aplicada em UsersService.changePassword.
  */
  await this.prisma.refreshSession.deleteMany({
    where: { userId: user.id },
  });

}

}