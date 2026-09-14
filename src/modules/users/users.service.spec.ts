import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from '../auth/auth.service';
import { LEGAL_TERMS_VERSION } from './legal-terms-version';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    refreshSession: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    linkedAccount: { findUnique: jest.Mock };
    userActivity: { findMany: jest.Mock; count: jest.Mock };
    consecrationProgress: { count: jest.Mock; findMany: jest.Mock };
    spiritualStats: { aggregate: jest.Mock };
  };
  let mailService: {
    sendOratioVerificationEmail: jest.Mock;
    sendOratioEmailChangeConfirmation: jest.Mock;
  };
  let authService: { verifyGoogleIdentity: jest.Mock };

  const ORIGINAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      refreshSession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      linkedAccount: { findUnique: jest.fn() },
      userActivity: { findMany: jest.fn(), count: jest.fn() },
      consecrationProgress: { count: jest.fn(), findMany: jest.fn() },
      spiritualStats: { aggregate: jest.fn() },
    };

    mailService = {
      sendOratioVerificationEmail: jest.fn(),
      sendOratioEmailChangeConfirmation: jest.fn(),
    };

    authService = {
      verifyGoogleIdentity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    process.env.ADMIN_PASSWORD = ORIGINAL_ADMIN_PASSWORD;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const validInput = {
      name: 'Maria',
      email: '  User@Example.com  ',
      password: 'ValidPass123',
      confirmPassword: 'ValidPass123',
    };

    it('rejects an unrecognized app', async () => {
      await expect(service.create(validInput as any, 'other-app')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects mismatched password confirmation', async () => {
      await expect(
        service.create({ ...validInput, confirmPassword: 'Different1' } as any, 'oratio'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects an email that is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(validInput as any, 'oratio')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('creates the account and returns a whitelist that never leaks the verification token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        emailVerified: false,
        isAdmin: false,
        emailVerificationToken: 'super-secret-token',
      });
      mailService.sendOratioVerificationEmail.mockResolvedValue(true);

      const result = await service.create(validInput as any, 'oratio');

      expect(result).toEqual({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        emailVerified: false,
        isAdmin: false,
        emailSent: true,
      });
      expect((result as any).emailVerificationToken).toBeUndefined();

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe('user@example.com');
      expect(createArgs.data.password).not.toBe('ValidPass123');
      await expect(bcrypt.compare('ValidPass123', createArgs.data.password)).resolves.toBe(
        true,
      );
    });

    it('stamps legalTermsAcceptedAt/legalTermsVersion in the same prisma.user.create call', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: false,
        isAdmin: false,
      });
      mailService.sendOratioVerificationEmail.mockResolvedValue(true);

      await service.create({ ...validInput, legalTermsAccepted: true } as any, 'oratio');

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.legalTermsAcceptedAt).toBeInstanceOf(Date);
      expect(createArgs.data.legalTermsVersion).toBe(LEGAL_TERMS_VERSION);
    });

    it('still creates the account when the verification email fails to send, but reports emailSent: false', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: false,
        isAdmin: false,
      });
      mailService.sendOratioVerificationEmail.mockResolvedValue(false);

      const result = await service.create(validInput as any, 'oratio');

      expect(result.emailSent).toBe(false);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProfile', () => {
    it('throws NotFoundException for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults spiritual stats to zero/null when the user has no SpiritualStats row yet', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        password: null,
        spiritualStats: null,
        consecrations: [],
        completedConsecrationDays: [],
        linkedAccounts: [{ id: 'la-1' }],
      });

      const result = await service.getProfile('user-1');

      expect(result.spiritualProgress).toEqual({
        consecrationStarted: false,
        daysCompleted: 0,
        prayersPrayed: 0,
        rosariesPrayed: 0,
        lastPrayerDate: null,
        prayerStreak: 0,
      });
      // conta só-Google: sem senha, com Google ligado
      expect(result.hasPassword).toBe(false);
      expect(result.hasGoogle).toBe(true);
    });

    it('reports real stats and consecration progress when they exist', async () => {
      const lastPrayerDate = new Date('2026-01-05');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        password: 'hashed-secret',
        spiritualStats: {
          prayersPrayed: 12,
          rosariesPrayed: 3,
          lastPrayerDate,
          prayerStreak: 5,
        },
        consecrations: [{ id: 'c1' }],
        completedConsecrationDays: [{ id: 'd1' }, { id: 'd2' }],
        linkedAccounts: [],
      });

      const result = await service.getProfile('user-1');

      expect(result.spiritualProgress).toEqual({
        consecrationStarted: true,
        daysCompleted: 2,
        prayersPrayed: 12,
        rosariesPrayed: 3,
        lastPrayerDate,
        prayerStreak: 5,
      });
      // conta com senha, e o hash NUNCA vaza no retorno
      expect(result.hasPassword).toBe(true);
      expect(result).not.toHaveProperty('password');
      // sem LinkedAccount google
      expect(result.hasGoogle).toBe(false);
    });

    it('legalTermsAccepted: false when the user never accepted (legalTermsAcceptedAt null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        password: null,
        welcomeSeenAt: null,
        legalTermsAcceptedAt: null,
        legalTermsVersion: null,
        spiritualStats: null,
        consecrations: [],
        completedConsecrationDays: [],
        linkedAccounts: [],
      });

      const result = await service.getProfile('user-1');
      expect(result.legalTermsAccepted).toBe(false);
    });

    it('legalTermsAccepted: false when the accepted version is stale', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        password: null,
        welcomeSeenAt: null,
        legalTermsAcceptedAt: new Date('2020-01-01'),
        legalTermsVersion: '2020-01-01',
        spiritualStats: null,
        consecrations: [],
        completedConsecrationDays: [],
        linkedAccounts: [],
      });

      const result = await service.getProfile('user-1');
      expect(result.legalTermsAccepted).toBe(false);
    });

    it('legalTermsAccepted: true when accepted at the current version', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Maria',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        password: null,
        welcomeSeenAt: null,
        legalTermsAcceptedAt: new Date(),
        legalTermsVersion: LEGAL_TERMS_VERSION,
        spiritualStats: null,
        consecrations: [],
        completedConsecrationDays: [],
        linkedAccounts: [],
      });

      const result = await service.getProfile('user-1');
      expect(result.legalTermsAccepted).toBe(true);
    });
  });

  describe('acceptLegalTerms', () => {
    it('always rewrites legalTermsAcceptedAt/legalTermsVersion, even on a second call', async () => {
      prisma.user.update.mockResolvedValue({});

      const result1 = await service.acceptLegalTerms('user-1');
      expect(result1).toEqual({ ok: true });
      expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        data: {
          legalTermsAcceptedAt: expect.any(Date),
          legalTermsVersion: LEGAL_TERMS_VERSION,
        },
      });

      // reaceite: chamar de novo (ex.: depois de um bump de versão) precisa
      // CONSEGUIR regravar — diferente de markWelcomeSeen, que é idempotente
      // e não regrava numa segunda chamada.
      const result2 = await service.acceptLegalTerms('user-1');
      expect(result2).toEqual({ ok: true });
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateProfile', () => {
    it('updates the name and selects an explicit whitelist that never leaks password or tokens', async () => {
      // O mock devolve exatamente o que o `select` pediu — a prova real de
      // que nada vaza está no `select` passado ao Prisma, abaixo.
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        name: 'Novo Nome',
        email: 'user@example.com',
        pendingEmail: null,
        createdAt: new Date('2026-01-01'),
        emailVerified: true,
        isAdmin: false,
      });

      const result = await service.updateProfile('user-1', 'Novo Nome');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'Novo Nome' },
        select: {
          id: true,
          name: true,
          email: true,
          pendingEmail: true,
          createdAt: true,
          emailVerified: true,
          isAdmin: true,
        },
      });
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('emailVerificationToken');
      expect(result).not.toHaveProperty('passwordResetToken');
      expect(result).not.toHaveProperty('pendingEmailToken');
    });
  });

  describe('changePassword', () => {
    it('throws when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('user-1', 'whatever', 'NewPass123'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an incorrect current password without touching sessions', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: hashed });

      await expect(
        service.changePassword('user-1', 'WrongPass', 'NewPass123'),
      ).rejects.toMatchObject({ message: 'Current password is incorrect' });

      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('updates the password and revokes every session on every device', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: hashed });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshSession.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.changePassword('user-1', 'CorrectPass123', 'NewPass123');

      expect(result).toEqual({ message: 'Password changed successfully' });
      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      await expect(bcrypt.compare('NewPass123', updateArgs.data.password)).resolves.toBe(true);
    });

    it('A8 — 409 (not 500) on a passwordless account, without calling bcrypt', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });

      await expect(
        service.changePassword('user-google', 'whatever', 'NewPass123'),
      ).rejects.toMatchObject({
        message: 'Esta conta não tem senha. Use "Definir senha" para criar uma.',
      });
      // não chegou ao bcrypt.compare(x, null) nem ao update
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('setPassword', () => {
    const CREDENTIAL = 'fresh-google-id-token';

    // login Google recente cujo sub é um LinkedAccount DESTE usuário
    const ownGoogleProof = (userId: string) => {
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'google-sub-own',
        email: 'usuario@exemplo.com',
        name: 'Fulano de Tal',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId,
        provider: 'google',
        providerAccountId: 'google-sub-own',
      });
    };

    it('rejects when the two fields do not match', async () => {
      await expect(
        service.setPassword('user-1', 'BrandNew123', 'Different123', CREDENTIAL),
      ).rejects.toMatchObject({ message: 'As senhas não conferem' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(authService.verifyGoogleIdentity).not.toHaveBeenCalled();
    });

    it('throws when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setPassword('ghost', 'BrandNew123', 'BrandNew123', CREDENTIAL),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authService.verifyGoogleIdentity).not.toHaveBeenCalled();
    });

    it('409 when the account already has a password — BEFORE verifying the Google credential', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: 'existing-hash' });

      await expect(
        service.setPassword('user-1', 'BrandNew123', 'BrandNew123', CREDENTIAL),
      ).rejects.toMatchObject({
        message:
          'Esta conta já tem uma senha. Use "Trocar senha" nas configurações (é preciso informar a senha atual).',
      });
      expect(authService.verifyGoogleIdentity).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('400 and password NOT written when the Google credential belongs to another account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'sub-de-outra-conta',
        email: 'outra@exemplo.com',
        name: 'Beltrano',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId: 'outro-user',
        provider: 'google',
        providerAccountId: 'sub-de-outra-conta',
      });

      await expect(
        service.setPassword('user-google', 'BrandNew123', 'BrandNew123', 'token-de-outra-conta'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Não foi possível confirmar sua identidade.',
      });
      expect(authService.verifyGoogleIdentity).toHaveBeenCalledWith('token-de-outra-conta');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('401 bubbles up and password NOT written when the Google credential is invalid/expired', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockRejectedValue(
        new UnauthorizedException('Não foi possível validar seu login com o Google. Tente de novo.'),
      );

      await expect(
        service.setPassword('user-google', 'BrandNew123', 'BrandNew123', 'expired'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('with a fresh credential of its own link: sets the hashed password and does NOT revoke any session', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      ownGoogleProof('user-google');
      prisma.user.update.mockResolvedValue({});

      const result = await service.setPassword('user-google', 'BrandNew123', 'BrandNew123', CREDENTIAL);

      expect(result).toEqual({ message: 'Senha definida.' });
      expect(authService.verifyGoogleIdentity).toHaveBeenCalledWith(CREDENTIAL);

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-google' });
      await expect(
        bcrypt.compare('BrandNew123', updateArgs.data.password),
      ).resolves.toBe(true);

      // diferente do changePassword: nada de deleteMany
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('requestEmailChange', () => {
    it('rejects an unsupported app', async () => {
      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'other-app'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the caller no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'oratio'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects requesting a change to the same email already in use', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'new@example.com' });

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'oratio'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an email already taken by another account', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', email: 'old@example.com' })
        .mockResolvedValueOnce({ id: 'someone-else' });

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'oratio'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rolls back the pending email fields when the confirmation email fails to send', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', email: 'old@example.com' })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});
      mailService.sendOratioEmailChangeConfirmation.mockResolvedValue(false);

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'oratio'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(prisma.user.update).toHaveBeenCalledTimes(2);
      const rollbackArgs = prisma.user.update.mock.calls[1][0];
      expect(rollbackArgs.data).toEqual({
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpires: null,
      });
    });

    it('sets the pending email and confirms the change is pending on success', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', email: 'old@example.com' })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});
      mailService.sendOratioEmailChangeConfirmation.mockResolvedValue(true);

      const result = await service.requestEmailChange('user-1', ' New@Example.com ', 'oratio');

      expect(result).toEqual({ emailChangePending: true, pendingEmail: 'new@example.com' });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelEmailChange', () => {
    it('clears every pending-email field', async () => {
      prisma.user.update.mockResolvedValue({});

      const result = await service.cancelEmailChange('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { pendingEmail: null, pendingEmailToken: null, pendingEmailExpires: null },
      });
      expect(result).toEqual({ message: 'Email change cancelled' });
    });
  });

  describe('getMySessions', () => {
    it('only returns non-expired sessions and never exposes raw tokenHash/userAgent/ipAddress', async () => {
      prisma.refreshSession.findMany.mockResolvedValue([]);

      await service.getMySessions('user-1');

      const args = prisma.refreshSession.findMany.mock.calls[0][0];
      expect(args.where.userId).toBe('user-1');
      expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
      expect(args.select).toEqual({
        id: true,
        createdAt: true,
        expiresAt: true,
        deviceLabel: true,
        location: true,
      });
    });
  });

  describe('revokeMySession', () => {
    it('throws NotFoundException when the session does not exist', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue(null);

      await expect(service.revokeMySession('user-1', 'session-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.refreshSession.delete).not.toHaveBeenCalled();
    });

    it("throws NotFoundException (not Forbidden) when the session belongs to a different user — doesn't leak that it exists", async () => {
      prisma.refreshSession.findUnique.mockResolvedValue({ userId: 'someone-else' });

      await expect(service.revokeMySession('user-1', 'session-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.refreshSession.delete).not.toHaveBeenCalled();
    });

    it('deletes the session when it belongs to the caller', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.refreshSession.delete.mockResolvedValue({});

      const result = await service.revokeMySession('user-1', 'session-x');

      expect(prisma.refreshSession.delete).toHaveBeenCalledWith({ where: { id: 'session-x' } });
      expect(result).toEqual({ message: 'Sessão encerrada' });
    });
  });

  describe('deleteAccount', () => {
    it('deletes the account when the current password matches', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: hashed });
      prisma.user.delete.mockResolvedValue({});

      await expect(
        service.deleteAccount('user-1', { password: 'CorrectPass123' }),
      ).resolves.toEqual({ message: 'Account deleted successfully' });

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('refuses to delete when the password is wrong, and never calls delete', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: hashed });

      await expect(
        service.deleteAccount('user-1', { password: 'WrongPass' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('400 (not 500) when a password account sends no password', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', password: hashed });

      await expect(
        service.deleteAccount('user-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('A8 — passwordless account with no googleCredential → 400, never calls delete', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });

      await expect(
        service.deleteAccount('user-google', {}),
      ).rejects.toMatchObject({
        message: 'Não foi possível confirmar sua identidade.',
      });
      expect(authService.verifyGoogleIdentity).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('A8 — passwordless account: fresh googleCredential whose sub matches a LinkedAccount of this user → deletes', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'google-sub-1',
        email: 'usuario@exemplo.com',
        name: 'Fulano de Tal',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId: 'user-google',
        provider: 'google',
        providerAccountId: 'google-sub-1',
      });
      prisma.user.delete.mockResolvedValue({});

      await expect(
        service.deleteAccount('user-google', { googleCredential: 'fresh-id-token' }),
      ).resolves.toEqual({ message: 'Account deleted successfully' });

      expect(authService.verifyGoogleIdentity).toHaveBeenCalledWith('fresh-id-token');
      expect(prisma.linkedAccount.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: 'google-sub-1',
          },
        },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-google' } });
    });

    it('A8 — passwordless account: valid Google token but sub is not linked to anyone → 400, never calls delete', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'someone-elses-sub',
        email: 'outro@exemplo.com',
        name: 'Beltrano',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount('user-google', { googleCredential: 'valid-but-wrong' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('E7 — passwordless account: Google token whose sub is linked to ANOTHER user → 400, never calls delete', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'sub-de-outra-conta',
        email: 'outra@exemplo.com',
        name: 'Beltrano',
      });
      // o sub casa um LinkedAccount, mas de OUTRO usuário
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId: 'outro-user',
        provider: 'google',
        providerAccountId: 'sub-de-outra-conta',
      });

      await expect(
        service.deleteAccount('user-google', { googleCredential: 'valido-mas-de-outra-conta' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('A8 — passwordless account: an invalid googleCredential lets the verifier 401 bubble up', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-google', password: null });
      authService.verifyGoogleIdentity.mockRejectedValue(
        new UnauthorizedException('Não foi possível validar seu login com o Google. Tente de novo.'),
      );

      await expect(
        service.deleteAccount('user-google', { googleCredential: 'garbage' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws when the account no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount('ghost', { password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    /*
    prova-identidade — a conta agora pode ter OS DOIS métodos (senha E Google).
    A decisão de qual prova aceitar sai do que a conta tem, não de
    `password == null`.
    */

    it('prova-identidade — conta COM senha: googleCredential cujo sub é de OUTRA conta → 400 e nunca chama delete', async () => {
      const hashed = await bcrypt.hash('SenhaCorreta123', 10);
      // conta com senha E um LinkedAccount google (mas o sub do token não é dela)
      prisma.user.findUnique.mockResolvedValue({ id: 'user-both', password: hashed });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'sub-de-outra-conta',
        email: 'outra@exemplo.com',
        name: 'Beltrano',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount('user-both', { googleCredential: 'token-de-outra-conta' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('prova-identidade — conta COM os dois métodos: aceita a senha correta OU um googleCredential fresco desta conta', async () => {
      const hashed = await bcrypt.hash('SenhaCorreta123', 10);

      // caso 1: prova por senha, sem googleCredential
      prisma.user.findUnique.mockResolvedValue({ id: 'user-both', password: hashed });
      prisma.user.delete.mockResolvedValue({});

      await expect(
        service.deleteAccount('user-both', { password: 'SenhaCorreta123' }),
      ).resolves.toEqual({ message: 'Account deleted successfully' });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-both' } });
      expect(authService.verifyGoogleIdentity).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // caso 2: MESMA conta, prova por Google fresco cujo sub casa um LinkedAccount dela
      prisma.user.findUnique.mockResolvedValue({ id: 'user-both', password: hashed });
      authService.verifyGoogleIdentity.mockResolvedValue({
        sub: 'google-sub-both',
        email: 'usuario@exemplo.com',
        name: 'Fulano de Tal',
      });
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId: 'user-both',
        provider: 'google',
        providerAccountId: 'google-sub-both',
      });
      prisma.user.delete.mockResolvedValue({});

      await expect(
        service.deleteAccount('user-both', { googleCredential: 'token-fresco-desta-conta' }),
      ).resolves.toEqual({ message: 'Account deleted successfully' });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-both' } });
    });
  });

  describe('assertAdmin', () => {
    it('resolves silently for an admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      await expect(service.assertAdmin('admin-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a non-admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });
      await expect(service.assertAdmin('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when the caller does not exist at all', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.assertAdmin('ghost')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getAllUsers', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      prisma.user.findMany.mockResolvedValue([]);
    });

    it('rejects a non-admin caller before touching the user list', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.getAllUsers('user-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects a non-admin caller even with a provider filter (no data returned)', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(
        service.getAllUsers('user-1', { provider: 'google' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('builds no filters when none are given', async () => {
      await service.getAllUsers('admin-1');

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('filters by name/email search (case-insensitive)', async () => {
      await service.getAllUsers('admin-1', { search: 'maria' });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { name: { contains: 'maria', mode: 'insensitive' } },
          { email: { contains: 'maria', mode: 'insensitive' } },
        ],
      });
    });

    it('filters by isAdmin and emailVerified when explicitly provided (including false)', async () => {
      await service.getAllUsers('admin-1', { isAdmin: false, emailVerified: true });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        isAdmin: false,
        emailVerified: true,
      });
    });

    it('adds an activeLastDays window filter across prayer activity and stats', async () => {
      await service.getAllUsers('admin-1', { activeLastDays: 30 });

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(1);
      expect(where.AND[0].OR).toHaveLength(2);
      expect(where.AND[0].OR[0].spiritualStats.lastPrayerDate.gte).toBeInstanceOf(Date);
      expect(where.AND[0].OR[1].activities.some.createdAt.gte).toBeInstanceOf(Date);
    });

    // --- método de entrada (spec admin-provedor) ---

    it('maps hasPassword/authProviders for each of the three states and never returns the hash', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u-oratio', name: 'O', email: 'o@example.com', createdAt: new Date(), emailVerified: true, isAdmin: false, spiritualStats: null, password: 'hash', linkedAccounts: [] },
        { id: 'u-google', name: 'G', email: 'g@example.com', createdAt: new Date(), emailVerified: true, isAdmin: false, spiritualStats: null, password: null, linkedAccounts: [{ provider: 'google' }] },
        { id: 'u-both', name: 'B', email: 'b@example.com', createdAt: new Date(), emailVerified: true, isAdmin: false, spiritualStats: null, password: 'hash', linkedAccounts: [{ provider: 'google' }] },
      ]);

      const result = await service.getAllUsers('admin-1');

      expect(result).toEqual([
        expect.objectContaining({ id: 'u-oratio', hasPassword: true, authProviders: [] }),
        expect.objectContaining({ id: 'u-google', hasPassword: false, authProviders: ['google'] }),
        expect.objectContaining({ id: 'u-both', hasPassword: true, authProviders: ['google'] }),
      ]);
      for (const u of result) {
        expect(u).not.toHaveProperty('password');
        expect(u).not.toHaveProperty('linkedAccounts');
      }
    });

    it('selects password + linkedAccounts.provider (needed to derive the booleans)', async () => {
      await service.getAllUsers('admin-1');

      const select = prisma.user.findMany.mock.calls[0][0].select;
      expect(select.password).toBe(true);
      expect(select.linkedAccounts).toEqual({ select: { provider: true } });
    });

    it('builds the where clause for provider=oratio (password, no LinkedAccount)', async () => {
      await service.getAllUsers('admin-1', { provider: 'oratio' });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        password: { not: null },
        linkedAccounts: { none: {} },
      });
    });

    it('builds the where clause for provider=google (no password, a google LinkedAccount)', async () => {
      await service.getAllUsers('admin-1', { provider: 'google' });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        password: null,
        linkedAccounts: { some: { provider: 'google' } },
      });
    });

    it('builds the where clause for provider=both (password AND a LinkedAccount)', async () => {
      await service.getAllUsers('admin-1', { provider: 'both' });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        password: { not: null },
        linkedAccounts: { some: {} },
      });
    });

    it('adds no provider clause for an unrecognized value', async () => {
      await service.getAllUsers('admin-1', { provider: 'banana' as never });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('combines provider with emailVerified (AND in the same where)', async () => {
      await service.getAllUsers('admin-1', { provider: 'google', emailVerified: true });

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        emailVerified: true,
        password: null,
        linkedAccounts: { some: { provider: 'google' } },
      });
    });
  });

  describe('getUserDetail', () => {
    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ isAdmin: false });

      await expect(service.getUserDetail('user-1', 'target-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ isAdmin: true })
        .mockResolvedValueOnce(null);

      await expect(service.getUserDetail('admin-1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('shapes the consecration summary and drops the raw arrays', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ isAdmin: true }).mockResolvedValueOnce({
        id: 'target-1',
        name: 'Maria',
        email: 'maria@example.com',
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        spiritualStats: null,
        consecrations: [{ id: 'c1' }],
        completedConsecrationDays: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
        password: 'hash',
        linkedAccounts: [],
      });

      const result = await service.getUserDetail('admin-1', 'target-1');

      expect(result.consecration).toEqual({ started: true, daysCompleted: 3 });
      expect(result.consecrations).toBeUndefined();
      expect(result.completedConsecrationDays).toBeUndefined();
    });

    it('exposes the login method (hasPassword + authProviders) without leaking the hash', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ isAdmin: true }).mockResolvedValueOnce({
        id: 'target-1',
        name: 'Maria',
        email: 'maria@example.com',
        createdAt: new Date(),
        emailVerified: true,
        isAdmin: false,
        spiritualStats: null,
        consecrations: [],
        completedConsecrationDays: [],
        password: 'hash',
        linkedAccounts: [{ provider: 'google' }],
      });

      const result = await service.getUserDetail('admin-1', 'target-1');

      expect(result.hasPassword).toBe(true);
      expect(result.authProviders).toEqual(['google']);
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('linkedAccounts');
    });
  });

  describe('deleteUserAdmin', () => {
    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.deleteUserAdmin('user-1', 'target-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to let an admin delete their own account through this path', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });

      await expect(service.deleteUserAdmin('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes a different target user', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      prisma.user.delete.mockResolvedValue({});

      const result = await service.deleteUserAdmin('admin-1', 'target-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
      expect(result).toEqual({ message: 'User deleted successfully' });
    });
  });

  describe('getUserActivity', () => {
    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.getUserActivity('user-1', 'target-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps activity rows to the public shape and only looks back 7 days', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      const timestamp = new Date('2026-01-05');
      prisma.userActivity.findMany.mockResolvedValue([
        { type: 'PRAYER', action: 'Rezou uma oração', createdAt: timestamp, userId: 'target-1' },
      ]);

      const result = await service.getUserActivity('admin-1', 'target-1');

      expect(result).toEqual({
        targetUserId: 'target-1',
        activities: [{ type: 'PRAYER', action: 'Rezou uma oração', timestamp }],
        total: 1,
      });

      const args = prisma.userActivity.findMany.mock.calls[0][0];
      expect(args.where.userId).toBe('target-1');
      expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('getAdminStats', () => {
    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.getAdminStats('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('aggregates every metric into the expected shape', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      prisma.user.count.mockResolvedValueOnce(100).mockResolvedValueOnce(80).mockResolvedValueOnce(5);
      prisma.consecrationProgress.count
        .mockResolvedValueOnce(40)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2);
      prisma.spiritualStats.aggregate.mockResolvedValue({
        _sum: { prayersPrayed: 300, rosariesPrayed: 50 },
      });
      prisma.userActivity.count
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(15);

      const result = await service.getAdminStats('admin-1');

      expect(result).toEqual({
        totalUsers: 100,
        totalVerified: 80,
        consecrationStarted: 40,
        consecrationCompleted: 10,
        prayersPrayed: 300,
        rosariesPrayed: 50,
        thisWeek: {
          newUsers: 5,
          prayers: 20,
          rosaries: 7,
          consecrations: 2,
          logins: 15,
        },
      });
    });

    it('defaults summed prayer/rosary counts to zero when there is no SpiritualStats data at all', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
      prisma.user.count.mockResolvedValue(0);
      prisma.consecrationProgress.count.mockResolvedValue(0);
      prisma.spiritualStats.aggregate.mockResolvedValue({
        _sum: { prayersPrayed: null, rosariesPrayed: null },
      });
      prisma.userActivity.count.mockResolvedValue(0);

      const result = await service.getAdminStats('admin-1');

      expect(result.prayersPrayed).toBe(0);
      expect(result.rosariesPrayed).toBe(0);
    });
  });

  describe('setAdminStatus', () => {
    beforeEach(() => {
      process.env.ADMIN_PASSWORD = 'correct-admin-secret';
      // assertAdmin's lookup on the caller
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
    });

    it('accepts the correct ADMIN_PASSWORD', async () => {
      prisma.user.update.mockResolvedValue({ id: 'target-1', isAdmin: true });

      await expect(
        service.setAdminStatus('admin-1', 'target-1', true, 'correct-admin-secret'),
      ).resolves.toEqual({ id: 'target-1', isAdmin: true });
    });

    it('rejects a wrong ADMIN_PASSWORD instead of throwing on length mismatch', async () => {
      await expect(
        service.setAdminStatus('admin-1', 'target-1', true, 'nope'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an empty ADMIN_PASSWORD candidate', async () => {
      await expect(
        service.setAdminStatus('admin-1', 'target-1', true, ''),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects even an empty candidate when ADMIN_PASSWORD itself is unset', async () => {
      delete process.env.ADMIN_PASSWORD;

      await expect(
        service.setAdminStatus('admin-1', 'target-1', true, ''),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to let an admin remove their own admin status', async () => {
      await expect(
        service.setAdminStatus('admin-1', 'admin-1', false, 'correct-admin-secret'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows an admin to grant themself admin again (only removal of self is blocked)', async () => {
      prisma.user.update.mockResolvedValue({ id: 'admin-1', isAdmin: true });

      await expect(
        service.setAdminStatus('admin-1', 'admin-1', true, 'correct-admin-secret'),
      ).resolves.toEqual({ id: 'admin-1', isAdmin: true });
    });
  });

  describe('getAdminTimeseries', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
    });

    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.getAdminTimeseries('user-1', 'users', '7d')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an invalid metric', async () => {
      await expect(
        service.getAdminTimeseries('admin-1', 'not-a-real-metric', '7d'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns exactly one bucket per day for a "7d" range', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getAdminTimeseries('admin-1', 'users', '7d');

      expect(result.granularity).toBe('day');
      expect(result.data).toHaveLength(7);
    });

    it('returns exactly one bucket per month for a "6m" range', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getAdminTimeseries('admin-1', 'users', '6m');

      expect(result.granularity).toBe('month');
      expect(result.data).toHaveLength(6);
    });

    it('falls back to "6m" for an unrecognized range value', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getAdminTimeseries('admin-1', 'users', 'not-a-range');

      expect(result.range).toBe('6m');
      expect(result.data).toHaveLength(6);
    });

    it('counts a real record into the correct day bucket', async () => {
      const today = new Date();
      prisma.user.findMany.mockResolvedValue([{ createdAt: today }]);

      const result = await service.getAdminTimeseries('admin-1', 'users', '7d');

      const total = result.data.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(total).toBe(1);
    });

    it('routes the "rosaries" metric through only the completed-rosary activity type/action', async () => {
      prisma.userActivity.findMany.mockResolvedValue([]);

      await service.getAdminTimeseries('admin-1', 'rosaries', '7d');

      expect(prisma.userActivity.findMany.mock.calls[0][0].where).toMatchObject({
        type: 'ROSARY',
        action: 'Terço concluído',
      });
    });

    it('routes the "consecrations" metric to ConsecrationProgress', async () => {
      prisma.consecrationProgress.findMany.mockResolvedValue([]);

      await service.getAdminTimeseries('admin-1', 'consecrations', '30d');

      expect(prisma.consecrationProgress.findMany).toHaveBeenCalled();
      expect(prisma.userActivity.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getActivityHeatmap', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
    });

    it('rejects a non-admin caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(service.getActivityHeatmap('user-1', 'logins', 90)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an invalid metric', async () => {
      await expect(
        service.getActivityHeatmap('admin-1', 'not-a-real-metric', 90),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('clamps an out-of-range "days" value into [7, 180]', async () => {
      prisma.userActivity.findMany.mockResolvedValue([]);

      const tooSmall = await service.getActivityHeatmap('admin-1', 'logins', 1);
      expect(tooSmall.days).toBe(7);

      const tooLarge = await service.getActivityHeatmap('admin-1', 'logins', 999);
      expect(tooLarge.days).toBe(180);
    });

    it('builds a 7x24 matrix and buckets a known-time activity into the right cell', async () => {
      // meio-dia UTC cai numa hora previsível em qualquer TZ de execução do teste
      prisma.userActivity.findMany.mockResolvedValue([{ createdAt: new Date('2026-01-05T12:00:00Z') }]);

      const result = await service.getActivityHeatmap('admin-1', 'logins', 90);

      expect(result.matrix).toHaveLength(7);
      result.matrix.forEach((row) => expect(row).toHaveLength(24));

      const total = result.matrix.flat().reduce((sum, count) => sum + count, 0);
      expect(total).toBe(1);
      expect(result.maxCount).toBeGreaterThanOrEqual(1);
    });

    it('reports maxCount as at least 1 even with zero activity (avoids dividing by zero on the frontend)', async () => {
      prisma.userActivity.findMany.mockResolvedValue([]);

      const result = await service.getActivityHeatmap('admin-1', 'logins', 90);

      expect(result.maxCount).toBe(1);
    });
  });
});
