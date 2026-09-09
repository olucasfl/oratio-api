import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { MailService } from '../mail/mail.service';
import { AppType } from 'src/enums/app-type.enum';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly authService: AuthService,
  ) {}

  /*
  =============================
  CREATE USER
  =============================
  */

  async create(data: CreateUserDto, app?: string) {

    if (app !== AppType.ORATIO) {
      throw new BadRequestException('Unknown or missing app');
    }

    if (data.password !== data.confirmPassword) {
      throw new ConflictException('Passwords do not match');
    }

    const email = data.email.trim().toLowerCase();

    const emailExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (emailExists) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email,
        password: hashedPassword,
        emailVerified: false,
        emailVerificationToken: token,
        emailVerificationTokenExpires: expires,
      },
    });

    const emailSent = await this.mailService.sendOratioVerificationEmail(user.email, token);

    /*
    A conta já foi criada mesmo se o email falhar — não faz sentido
    reverter a criação por causa disso. Mas o frontend precisa saber
    que o email de verificação pode não ter chegado, pra não deixar a
    pessoa esperando um email que nunca vai vir sem nenhum aviso.

    Retorno é uma lista branca explícita (não um spread do user menos
    a senha) porque esse endpoint é público e sem autenticação: um
    spread deixava vazar emailVerificationToken (e os demais tokens)
    na própria resposta do cadastro, permitindo verificar a conta sem
    nunca ter acesso ao email informado.
    */
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
      emailSent,
    };
  }

  /*
  =============================
  GET USER PROFILE
  =============================
  */

  async getProfile(userId: string) {

  const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        pendingEmail: true,
        createdAt: true,
        emailVerified: true,
        isAdmin: true,
        spiritualStats: true,
        consecrations: true,
        completedConsecrationDays: { select: { id: true } },
      },
    });

  if (!user) {
    throw new NotFoundException("User not found")
  }

  return {

    id: user.id,
    name: user.name,
    email: user.email,
    pendingEmail: user.pendingEmail,
    createdAt: user.createdAt,
    emailVerified: user.emailVerified,
    isAdmin: user.isAdmin,

    spiritualProgress: {

    consecrationStarted: user.consecrations.length > 0,

    daysCompleted: user.completedConsecrationDays.length,

    prayersPrayed: user.spiritualStats?.prayersPrayed || 0,

    rosariesPrayed: user.spiritualStats?.rosariesPrayed || 0,

    lastPrayerDate: user.spiritualStats?.lastPrayerDate || null,

    prayerStreak: user.spiritualStats?.prayerStreak || 0

    }

  }

  }

  /*
  =============================
  UPDATE NAME
  =============================
  */

  async updateProfile(userId: string, name: string) {

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });

    const { password, ...safeUser } = user;

    return safeUser;
  }

  /*
  =============================
  CHANGE PASSWORD (autenticado, com senha atual)
  =============================
  */

  async changePassword(userId: string, currentPassword: string, newPassword: string) {

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    /*
    Conta só-Google: não existe "senha atual" para conferir, e
    `bcrypt.compare(x, null)` lança. 409 explícito apontando para "definir
    senha" — não pode depender de o frontend esconder o botão de troca.
    */
    if (!user.password) {
      throw new ConflictException(
        'Esta conta não tem senha. Use "Definir senha" para criar uma.',
      );
    }

    const matches = await bcrypt.compare(currentPassword, user.password);

    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    // Invalida todas as sessões (todos os dispositivos, incluindo o
    // atual) — força um novo login em qualquer lugar, caso a troca
    // seja por suspeita de acesso indevido.
    await this.prisma.refreshSession.deleteMany({
      where: { userId },
    });

    return { message: 'Password changed successfully' };

  }

  /*
  =============================
  DEFINIR SENHA (autenticado, sem senha atual)
  =============================
  Para quem entrou só por Google e ainda não tem senha. Só aceita quando
  `User.password` é null. Se já houver senha, 409 — a rota certa aí é
  `change-password` (que exige a senha atual). Isso fecha o caminho de
  alguém com uma sessão de acesso roubada CRIAR uma senha e persistir numa
  conta que já tinha dono.

  NÃO revoga `RefreshSession` — diferente de `changePassword`/`resetPassword`.
  Aquelas revogam porque uma senha que existia deixou de valer; aqui nada
  foi invalidado (não havia senha), então revogar só deslogaria a própria
  pessoa sem ganho de segurança.
  */
  async setPassword(userId: string, password: string, confirmPassword: string) {

    if (password !== confirmPassword) {
      throw new BadRequestException('As senhas não conferem');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.password) {
      throw new ConflictException(
        'Esta conta já tem uma senha. Use "Trocar senha" nas configurações (é preciso informar a senha atual).',
      );
    }

    const hashed = await bcrypt.hash(password, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: 'Senha definida.' };

  }

  /*
  =============================
  TROCA DE EMAIL (2 passos: solicitar -> confirmar no novo endereço)
  =============================
  */

  async requestEmailChange(userId: string, newEmail: string, app?: string) {

    // Hoje só o Oratio tem essa funcionalidade no frontend.
    if (app !== AppType.ORATIO) {
      throw new BadRequestException('Unknown or unsupported app');
    }

    const email = newEmail.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (email === user.email) {
      throw new ConflictException('This is already your current email');
    }

    const taken = await this.prisma.user.findUnique({
      where: { email },
    });

    if (taken) {
      throw new ConflictException('Email already in use');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: email,
        pendingEmailToken: token,
        pendingEmailExpires: expires,
      },
    });

    const emailSent = await this.mailService.sendOratioEmailChangeConfirmation(email, token);

    if (!emailSent) {

      // Desfaz a troca pendente — sem isso, o perfil ficaria mostrando
      // "confirmação pendente" pra um email que nunca recebeu o link.
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpires: null,
        },
      });

      throw new ServiceUnavailableException(
        'Failed to send confirmation email. Please try again in a moment.',
      );

    }

    return {
      emailChangePending: true,
      pendingEmail: email,
    };

  }

  async cancelEmailChange(userId: string) {

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpires: null,
      },
    });

    return { message: 'Email change cancelled' };

  }

  /*
  =============================
  SESSÕES ATIVAS (dispositivos)
  =============================
  */

  async getMySessions(userId: string) {

    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      // nunca devolve tokenHash nem userAgent/ipAddress crus — só os
      // rótulos já resolvidos, que é o que a tela precisa mostrar
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        deviceLabel: true,
        location: true,
      },
    });

    return sessions;
  }

  async revokeMySession(userId: string, sessionId: string) {

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    // Confere dono antes de apagar — sem isso, um usuário autenticado
    // podia encerrar a sessão de QUALQUER outro usuário só adivinhando
    // um id (que nem é segredo, é só uma chave primária sequencial-ish).
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Sessão não encontrada');
    }

    await this.prisma.refreshSession.delete({ where: { id: sessionId } });

    return { message: 'Sessão encerrada' };
  }

  /*
  =============================
  DELETE ACCOUNT
  =============================
  */

  /*
  Exige uma prova de identidade antes de apagar — sem isso, só a posse do
  access token (roubável via XSS, dispositivo destravado, etc.) já bastava
  pra destruir a conta inteira e todo o histórico, sem chance de confirmação
  nem de estorno.

  - Conta com senha  -> `password` + `bcrypt.compare` (comportamento antigo).
  - Conta só-Google  -> `googleCredential`: um id_token fresco do Google,
    verificado pelo MESMO helper do POST /auth/google, cujo `sub` precisa
    casar um `LinkedAccount` google DESTE usuário. É a prova equivalente à
    senha (ARCHITECTURE.md §7). Não conseguir excluir seria problema de
    LGPD, então algum caminho sem senha precisa existir.
  */
  async deleteAccount(
    userId: string,
    proof: { password?: string; googleCredential?: string },
  ) {

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (!user.password) {
      if (!proof.googleCredential) {
        throw new BadRequestException(
          'Não foi possível confirmar sua identidade para excluir a conta.',
        );
      }

      const identity = await this.authService.verifyGoogleIdentity(
        proof.googleCredential,
      );

      const link = await this.prisma.linkedAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: identity.sub,
          },
        },
      });

      // Token válido do Google, mas de outra conta Google que não está
      // ligada a este usuário -> não é prova para excluir ESTA conta.
      if (!link || link.userId !== userId) {
        throw new BadRequestException(
          'Não foi possível confirmar sua identidade para excluir a conta.',
        );
      }

      await this.prisma.user.delete({
        where: { id: userId },
      });

      return {
        message: 'Account deleted successfully',
      };
    }

    if (!proof.password) {
      throw new BadRequestException('Senha é obrigatória');
    }

    const matches = await bcrypt.compare(proof.password, user.password);

    if (!matches) {
      throw new UnauthorizedException('Senha incorreta');
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: 'Account deleted successfully',
    };
  }

  async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
  }

  async getAllUsers(userId: string, filters?: { search?: string; isAdmin?: boolean; emailVerified?: boolean; activeLastDays?: number }) {
    await this.assertAdmin(userId);

    const where: any = {};

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters?.isAdmin !== undefined) {
      where.isAdmin = filters.isAdmin;
    }

    if (filters?.emailVerified !== undefined) {
        where.emailVerified = filters.emailVerified;
      }

        if (filters?.activeLastDays) {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - filters.activeLastDays);

    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          {
            spiritualStats: {
              lastPrayerDate: {
                gte: daysAgo,
              },
            },
          },
          {
            activities: {
              some: {
                createdAt: {
                  gte: daysAgo,
                },
              },
            },
          },
        ],
      },
    ];
  }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        emailVerified: true,
        isAdmin: true,
        spiritualStats: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUserDetail(userId: string, targetUserId: string) {
    await this.assertAdmin(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        emailVerified: true,
        isAdmin: true,
        spiritualStats: {
          select: {
            prayersPrayed: true,
            rosariesPrayed: true,
            prayerStreak: true,
            lastPrayerDate: true,
          },
        },
        consecrations: true,
        completedConsecrationDays: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      consecration: {
        started: user.consecrations.length > 0,
        daysCompleted: user.completedConsecrationDays.length,
      },
      consecrations: undefined,
      completedConsecrationDays: undefined,
    };
  }

  async deleteUserAdmin(userId: string, targetUserId: string) {
    await this.assertAdmin(userId);

    if (userId === targetUserId) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    await this.prisma.user.delete({
      where: { id: targetUserId },
    });

    return { message: 'User deleted successfully' };
  }

  async getUserActivity(userId: string, targetUserId: string) {
    await this.assertAdmin(userId);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activities = await this.prisma.userActivity.findMany({
      where: {
        userId: targetUserId,
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      targetUserId,
      activities: activities.map((a) => ({
        type: a.type,
        action: a.action,
        timestamp: a.createdAt,
      })),
      total: activities.length,
    };
  }

  // Segunda-feira 00h da semana atual, no fuso do Brasil — não é
  // "últimos 7 dias corridos". Uma janela rolante (agora - 7 dias)
  // desliza junto com o relógio: a cada dia que passa, o dia mais
  // antigo cai fora da conta e um dia novo (ainda incompleto) entra,
  // o que pode fazer o número CAIR de um dia pro outro sem nenhum
  // dado ter sumido de verdade — só saiu da janela. Com semana civil
  // fixa, o número só cresce ao longo da semana e reseta na segunda.
  private getStartOfWeekBrazil(): Date {
    const now = new Date();

    const weekdayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
    }).format(now);

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dow = weekdayMap[weekdayShort] ?? 1;
    const daysSinceMonday = (dow + 6) % 7; // dom=6, seg=0, ter=1 ...

    const mondayInstant = new Date(now.getTime() - daysSinceMonday * 86_400_000);
    const mondayKey = mondayInstant.toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    });

    return new Date(`${mondayKey}T00:00:00-03:00`);
  }

  async getAdminStats(userId: string) {
    await this.assertAdmin(userId);

    const startOfWeek = this.getStartOfWeekBrazil();

    const [
      totalUsers,
      totalVerified,
      consecrationStarted,
      consecrationCompleted,
      totalPrayers,
      newUsersWeek,
      prayersWeek,
      rosariesWeek,
      consecrationsWeek,
      loginsWeek,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.consecrationProgress.count(),
      // Terminar mantém a linha (só cancelar apaga) — dá pra contar
      // quantas consagrações realmente chegaram ao dia 33.
      this.prisma.consecrationProgress.count({ where: { completedAt: { not: null } } }),
      this.prisma.spiritualStats.aggregate({
        _sum: { prayersPrayed: true, rosariesPrayed: true },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      this.prisma.userActivity.count({
        where: { type: 'PRAYER', createdAt: { gte: startOfWeek } },
      }),
      // Só "Terço concluído" — "Iniciou o terço" também usa type ROSARY
      // e infla a contagem se não filtrar pela ação.
      this.prisma.userActivity.count({
        where: {
          type: 'ROSARY',
          action: 'Terço concluído',
          createdAt: { gte: startOfWeek },
        },
      }),
      this.prisma.consecrationProgress.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      this.prisma.userActivity.count({
        where: { type: 'LOGIN', createdAt: { gte: startOfWeek } },
      }),
    ]);

    return {
      totalUsers,
      totalVerified,
      consecrationStarted,
      consecrationCompleted,
      prayersPrayed: totalPrayers._sum.prayersPrayed || 0,
      rosariesPrayed: totalPrayers._sum.rosariesPrayed || 0,
      thisWeek: {
        newUsers: newUsersWeek,
        prayers: prayersWeek,
        rosaries: rosariesWeek,
        consecrations: consecrationsWeek,
        logins: loginsWeek,
      },
    };
  }

  /*
  Compara em tempo constante via hash de tamanho fixo (SHA-256) em vez de
  comparar as strings direto: `!==` sai assim que acha o primeiro byte
  diferente, então o tempo de resposta varia com quantos caracteres do
  começo acertaram — um canal lateral de timing pra adivinhar o segredo
  aos poucos. Hashear primeiro também evita que `timingSafeEqual` lance
  erro quando os dois lados têm tamanhos diferentes.
  */
  private matchesAdminPassword(candidate: string): boolean {
    const expected = process.env.ADMIN_PASSWORD;

    // ADMIN_PASSWORD não configurado nunca deve "combinar" com nada,
    // nem com uma string vazia enviada por quem for chamar a rota.
    if (!expected) return false;

    const candidateHash = createHash('sha256').update(candidate ?? '').digest();
    const expectedHash = createHash('sha256').update(expected).digest();

    return timingSafeEqual(candidateHash, expectedHash);
  }

  async setAdminStatus(
    userId: string,
    targetUserId: string,
    isAdmin: boolean,
    adminPassword: string
  ) {
    await this.assertAdmin(userId);

    if (!this.matchesAdminPassword(adminPassword)) {
      throw new ForbiddenException("Senha de admin inválida");
    }

    if (userId === targetUserId && isAdmin === false) {
      throw new ForbiddenException("Você não pode remover seu próprio admin");
    }

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { isAdmin },
      select: { id: true, isAdmin: true },
    });
  }

  /*
  =============================
  ADMIN — GRÁFICOS (série temporal + heatmap)
  =============================
  */

  private readonly ACTIVITY_TYPE_BY_METRIC: Record<
    string,
    { type: string; action?: string }
  > = {
    prayers: { type: 'PRAYER' },
    // "Iniciou o terço" também usa type ROSARY — sem o filtro de action
    // isso contaria início E conclusão como se fossem a mesma coisa.
    rosaries: { type: 'ROSARY', action: 'Terço concluído' },
    logins: { type: 'LOGIN' },
  };

  private validateMetric(metric: string) {
    if (
      metric !== 'users' &&
      metric !== 'consecrations' &&
      !this.ACTIVITY_TYPE_BY_METRIC[metric]
    ) {
      throw new BadRequestException('Métrica inválida');
    }
  }

  private async fetchMetricDates(
    metric: string,
    since: Date,
  ): Promise<Date[]> {
    if (metric === 'users') {
      const rows = await this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      });
      return rows.map((r) => r.createdAt);
    }

    if (metric === 'consecrations') {
      const rows = await this.prisma.consecrationProgress.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      });
      return rows.map((r) => r.createdAt);
    }

    const config = this.ACTIVITY_TYPE_BY_METRIC[metric];
    const rows = await this.prisma.userActivity.findMany({
      where: {
        type: config.type,
        ...(config.action ? { action: config.action } : {}),
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    });
    return rows.map((r) => r.createdAt);
  }

  // "YYYY-MM-DD" no fuso do Brasil — mesma técnica já usada em
  // ActivityService pra fronteira de dia do streak. O servidor pode
  // rodar em UTC; sem isso, um acesso às 21h no Brasil vazaria pro
  // dia seguinte no agrupamento.
  private getBrazilDateKey(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  private brazilMidnightInstant(dateKey: string): Date {
    return new Date(`${dateKey}T00:00:00-03:00`);
  }

  // Dia da semana (0=domingo) e hora (0-23) no fuso do Brasil.
  private getBrazilDayHour(date: Date): { day: number; hour: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };

    const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    let hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    if (hour === 24) hour = 0; // alguns ambientes ICU retornam "24" pra meia-noite com hour12:false

    return { day: weekdayMap[weekdayPart] ?? 0, hour };
  }

  async getAdminTimeseries(userId: string, metric: string, range: string) {
    await this.assertAdmin(userId);
    this.validateMetric(metric);

    const RANGE_CONFIG: Record<
      string,
      { granularity: 'day' | 'month'; amount: number }
    > = {
      '7d': { granularity: 'day', amount: 7 },
      '30d': { granularity: 'day', amount: 30 },
      '6m': { granularity: 'month', amount: 6 },
      '12m': { granularity: 'month', amount: 12 },
    };
    const resolvedRange = RANGE_CONFIG[range] ? range : '6m';
    const config = RANGE_CONFIG[resolvedRange];

    const data: { period: string; label: string; count: number }[] = [];

    if (config.granularity === 'day') {
      // Datas no calendário do Brasil, não no fuso do servidor.
      const dayKeys: string[] = [];
      for (let i = config.amount - 1; i >= 0; i--) {
        dayKeys.push(this.getBrazilDateKey(new Date(Date.now() - i * 86_400_000)));
      }

      const start = this.brazilMidnightInstant(dayKeys[0]);
      const dates = await this.fetchMetricDates(metric, start);

      const buckets = new Map<string, number>();
      for (const d of dates) {
        const key = this.getBrazilDateKey(d);
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }

      for (const key of dayKeys) {
        data.push({
          period: key,
          label: `${key.slice(8, 10)}/${key.slice(5, 7)}`,
          count: buckets.get(key) || 0,
        });
      }
    } else {
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth() - (config.amount - 1),
        1,
      );

      const dates = await this.fetchMetricDates(metric, start);

      const buckets = new Map<string, number>();
      for (const d of dates) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }

      const MONTH_LABELS = [
        'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
        'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
      ];

      for (let i = 0; i < config.amount; i++) {
        const d = new Date(
          now.getFullYear(),
          now.getMonth() - (config.amount - 1) + i,
          1,
        );
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        data.push({
          period: key,
          label: MONTH_LABELS[d.getMonth()],
          count: buckets.get(key) || 0,
        });
      }
    }

    return {
      metric,
      range: resolvedRange,
      granularity: config.granularity,
      data,
    };
  }

  async getActivityHeatmap(userId: string, metric: string, days: number) {
    await this.assertAdmin(userId);
    this.validateMetric(metric);

    const clampedDays = Math.min(Math.max(days || 90, 7), 180);
    const start = new Date(Date.now() - clampedDays * 86_400_000);

    const dates = await this.fetchMetricDates(metric, start);

    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const d of dates) {
      const { day, hour } = this.getBrazilDayHour(d);
      matrix[day][hour] += 1;
    }

    const maxCount = Math.max(1, ...matrix.flat());

    return { metric, days: clampedDays, matrix, maxCount };
  }

}
