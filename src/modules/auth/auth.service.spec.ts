import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from '../mail/mail.service';

jest.mock('./utils/session-info.util', () => ({
  parseDeviceLabel: jest.fn(() => 'Chrome · Windows'),
  resolveLocation: jest.fn(),
}));

jest.mock('google-auth-library');

import { resolveLocation } from './utils/session-info.util';
import { OAuth2Client } from 'google-auth-library';
import { Prisma } from '@prisma/client';

// Um único mock de verifyIdToken compartilhado por todos os OAuth2Client
// instanciados dentro do serviço.
const mockVerifyIdToken = jest.fn();
(OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({
  verifyIdToken: mockVerifyIdToken,
}));

/** Payload sintético de um id_token válido do Google. */
const googlePayload = (over: Record<string, unknown> = {}) => ({
  getPayload: () => ({
    sub: 'google-sub-1',
    email: 'fulano@example.com',
    email_verified: true,
    iss: 'https://accounts.google.com',
    aud: 'test-google-client-id',
    name: 'Fulano de Tal',
    ...over,
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    refreshSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    linkedAccount: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let mailService: {
    sendOratioVerificationEmail: jest.Mock;
    sendOratioPasswordResetEmail: jest.Mock;
  };

  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      JWT_SECRET_KEY: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    };

    mockVerifyIdToken.mockReset();

    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshSession: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      linkedAccount: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      // callback form: roda o callback com o próprio mock como "tx"
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    };

    mailService = {
      sendOratioVerificationEmail: jest.fn(),
      sendOratioPasswordResetEmail: jest.fn(),
    };

    (resolveLocation as jest.Mock).mockReset().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('rejects an unknown email without revealing whether the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@example.com', 'whatever')).rejects.toMatchObject({
        message: 'Invalid credentials',
      });
    });

    it('looks up the email trimmed and lowercased', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('  User@Example.com  ', 'whatever'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('rejects a wrong password with the same message as an unknown email', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: hashed,
        emailVerified: true,
      });

      await expect(
        service.login('user@example.com', 'WrongPass'),
      ).rejects.toMatchObject({ message: 'Invalid credentials' });
    });

    it('rejects a correct password when the email is not verified yet', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: hashed,
        emailVerified: false,
      });

      await expect(
        service.login('user@example.com', 'CorrectPass123'),
      ).rejects.toMatchObject({
        message: 'Please verify your email before logging in',
      });
    });

    it('returns a fresh token pair and creates a new session row on success', async () => {
      const hashed = await bcrypt.hash('CorrectPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: hashed,
        emailVerified: true,
      });
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      prisma.refreshSession.create.mockResolvedValue({});

      const result = await service.login('user@example.com', 'CorrectPass123', {
        userAgent: 'Mozilla/5.0 Chrome',
        ipAddress: '203.0.113.5',
      });

      expect(result).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      });
      expect(prisma.refreshSession.create).toHaveBeenCalledTimes(1);

      const createArgs = prisma.refreshSession.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.deviceLabel).toBe('Chrome · Windows');
      expect(createArgs.data.ipAddress).toBe('203.0.113.5');
      // never stores the raw token, only a hash of it
      expect(createArgs.data.tokenHash).not.toBe('refresh-token');
    });
  });

  describe('generateTokens', () => {
    it('does not attempt to resolve a location when no IP address is given', async () => {
      jwtService.sign.mockReturnValue('token');
      prisma.refreshSession.create.mockResolvedValue({});

      await service.generateTokens('user-1', 'user@example.com');

      expect(resolveLocation).not.toHaveBeenCalled();
      expect(prisma.refreshSession.create.mock.calls[0][0].data.location).toBeNull();
    });

    it('stores the resolved location when an IP address is given', async () => {
      jwtService.sign.mockReturnValue('token');
      (resolveLocation as jest.Mock).mockResolvedValue('São Paulo, Brazil');
      prisma.refreshSession.create.mockResolvedValue({});

      await service.generateTokens('user-1', 'user@example.com', {
        ipAddress: '203.0.113.5',
      });

      expect(resolveLocation).toHaveBeenCalledWith('203.0.113.5');
      expect(prisma.refreshSession.create.mock.calls[0][0].data.location).toBe(
        'São Paulo, Brazil',
      );
    });
  });

  describe('refresh', () => {
    it('rejects an invalid or expired refresh token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh('bad-token')).rejects.toMatchObject({
        message: 'Invalid or expired refresh token',
      });
    });

    it('rejects a token whose user no longer exists', async () => {
      jwtService.verify.mockReturnValue({ sub: 'ghost-user', email: 'x@x.com' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token that does not match any active (non-expired) session — e.g. already rotated out', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'user@example.com' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
      prisma.refreshSession.findFirst.mockResolvedValue(null);

      await expect(service.refresh('stale-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rotates the SAME session row instead of creating a new one', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'user@example.com' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
      prisma.refreshSession.findFirst.mockResolvedValue({ id: 'session-1' });
      jwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      prisma.refreshSession.update.mockResolvedValue({});

      const result = await service.refresh('current-token');

      expect(result).toEqual({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });
      expect(prisma.refreshSession.update).toHaveBeenCalledTimes(1);
      expect(prisma.refreshSession.update.mock.calls[0][0].where).toEqual({ id: 'session-1' });
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('silently does nothing when the refresh token fails to verify', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.logout('garbage')).resolves.toBeUndefined();
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('revokes only the session tied to the given refresh token', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });
      prisma.refreshSession.deleteMany.mockResolvedValue({ count: 1 });

      await service.logout('current-token');

      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', tokenHash: expect.any(String) },
      });
    });
  });

  describe('confirmEmailToken', () => {
    it('rejects an unknown token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.confirmEmailToken('bad')).rejects.toMatchObject({
        message: 'Invalid verification token',
      });
    });

    it('is idempotent: a second confirmation of an already-verified account succeeds without writing again', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        emailVerified: true,
        emailVerificationTokenExpires: null,
      });

      const result = await service.confirmEmailToken('token');

      expect(result).toEqual({ alreadyVerified: true });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token for an account not yet verified', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        emailVerified: false,
        emailVerificationTokenExpires: new Date(Date.now() - 1000),
      });

      await expect(service.confirmEmailToken('token')).rejects.toMatchObject({
        message: 'Verification token expired',
      });
    });

    it('marks the email verified and keeps the token in place (does not clear it)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        emailVerified: false,
        emailVerificationTokenExpires: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.confirmEmailToken('token');

      expect(result).toEqual({ alreadyVerified: false });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
    });
  });

  describe('verifyEmail', () => {
    function fakeResponse() {
      return { redirect: jest.fn() } as any;
    }

    it('redirects to the production login page for the oratio app', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        emailVerified: true,
        emailVerificationTokenExpires: null,
      });
      const res = fakeResponse();

      await service.verifyEmail('token', 'oratio', res);

      expect(res.redirect).toHaveBeenCalledWith('https://oratio-phi.vercel.app/login');
    });

    it('rejects an unknown app without redirecting', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        emailVerified: true,
        emailVerificationTokenExpires: null,
      });
      const res = fakeResponse();

      await expect(service.verifyEmail('token', 'other-app', res)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('propagates an invalid-token failure instead of redirecting', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const res = fakeResponse();

      await expect(service.verifyEmail('bad', 'oratio', res)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('confirmEmailChange', () => {
    it('rejects when no user has that pending-email token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.confirmEmailChange('bad')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the user has no pending email at all', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', pendingEmail: null });

      await expect(service.confirmEmailChange('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('is idempotent: confirming again after the email already changed just reports success', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
        pendingEmail: 'new@example.com',
      });

      const result = await service.confirmEmailChange('token');

      expect(result).toEqual({ alreadyConfirmed: true, email: 'new@example.com' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired confirmation link', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({
        id: 'user-1',
        email: 'old@example.com',
        pendingEmail: 'new@example.com',
        pendingEmailExpires: new Date(Date.now() - 1000),
      });

      await expect(service.confirmEmailChange('token')).rejects.toMatchObject({
        message: 'Confirmation link expired',
      });
    });

    it('rejects when the target email was taken by someone else in the meantime', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'old@example.com',
          pendingEmail: 'new@example.com',
          pendingEmailExpires: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce({ id: 'someone-else' });

      await expect(service.confirmEmailChange('token')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('applies the pending email on success', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'old@example.com',
          pendingEmail: 'new@example.com',
          pendingEmailExpires: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});

      const result = await service.confirmEmailChange('token');

      expect(result).toEqual({ alreadyConfirmed: false, email: 'new@example.com' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { email: 'new@example.com' },
      });
    });
  });

  describe('resendVerification', () => {
    it('returns a generic message without sending mail when the email is unknown', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.resendVerification('nobody@example.com', 'oratio');

      expect(result.message).toMatch(/if this email exists/i);
      expect(mailService.sendOratioVerificationEmail).not.toHaveBeenCalled();
    });

    it('short-circuits when the account is already verified', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', emailVerified: true });

      const result = await service.resendVerification('user@example.com', 'oratio');

      expect(result.message).toMatch(/already verified/i);
      expect(mailService.sendOratioVerificationEmail).not.toHaveBeenCalled();
    });

    it('rejects an unknown app for an unverified existing account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        emailVerified: false,
      });
      prisma.user.update.mockResolvedValue({});

      await expect(
        service.resendVerification('user@example.com', 'unknown-app'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mailService.sendOratioVerificationEmail).not.toHaveBeenCalled();
    });

    it('reports a real send failure instead of a fake success (existence is already established here)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        emailVerified: false,
      });
      prisma.user.update.mockResolvedValue({});
      mailService.sendOratioVerificationEmail.mockResolvedValue(false);

      await expect(
        service.resendVerification('user@example.com', 'oratio'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('issues a new token and confirms success when the email is sent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        emailVerified: false,
      });
      prisma.user.update.mockResolvedValue({});
      mailService.sendOratioVerificationEmail.mockResolvedValue(true);

      const result = await service.resendVerification('user@example.com', 'oratio');

      expect(result.message).toMatch(/resent successfully/i);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(mailService.sendOratioVerificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });
  });

  describe('checkVerification', () => {
    it('reports unverified for an unknown email (never a lookup error)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.checkVerification('nobody@example.com')).resolves.toEqual({
        verified: false,
      });
    });

    it('reports the real verified status of an existing account', async () => {
      prisma.user.findUnique.mockResolvedValue({ emailVerified: true });

      await expect(service.checkVerification('user@example.com')).resolves.toEqual({
        verified: true,
      });
    });
  });

  describe('requestPasswordReset', () => {
    it('does nothing when the email is unknown (no existence leak)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestPasswordReset('nobody@example.com', 'oratio');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailService.sendOratioPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does nothing for an unrecognized app even for a real account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });

      await service.requestPasswordReset('user@example.com', 'other-app');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailService.sendOratioPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('issues a reset token and emails it for a known account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
      prisma.user.update.mockResolvedValue({});

      await service.requestPasswordReset('user@example.com', 'oratio');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordResetToken: expect.any(String),
          passwordResetExpires: expect.any(Date),
        },
      });
      expect(mailService.sendOratioPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });
  });

  describe('resetPassword', () => {
    it('revokes every existing refresh session so a leaked refresh token stops working after reset', async () => {
      const user = {
        id: 'user-1',
        passwordResetToken: 'valid-token',
        passwordResetExpires: new Date(Date.now() + 60_000),
      };

      prisma.user.findFirst.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, password: 'hashed' });

      await service.resetPassword('valid-token', 'NewPass123');

      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
    });

    it('rejects an invalid or expired token without touching any session', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'NewPass123'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('stores a bcrypt hash of the new password, never the plaintext', async () => {
      const user = {
        id: 'user-1',
        passwordResetToken: 'valid-token',
        passwordResetExpires: new Date(Date.now() + 60_000),
      };
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({});

      await service.resetPassword('valid-token', 'NewPass123');

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.data.password).not.toBe('NewPass123');
      await expect(
        bcrypt.compare('NewPass123', updateArgs.data.password),
      ).resolves.toBe(true);
      expect(updateArgs.data.passwordResetToken).toBeNull();
      expect(updateArgs.data.passwordResetExpires).toBeNull();
    });

    it('sets a password on an account that never had one (só-Google recovery)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-google',
        email: 'g@example.com',
        password: null,
        passwordResetToken: 'valid-token',
        passwordResetExpires: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshSession.deleteMany.mockResolvedValue({ count: 0 });

      await service.resetPassword('valid-token', 'BrandNew123');

      const updateArgs = prisma.user.update.mock.calls[0][0];
      await expect(
        bcrypt.compare('BrandNew123', updateArgs.data.password),
      ).resolves.toBe(true);
      // reset sempre revoga as sessões
      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-google' },
      });
    });
  });

  describe('login — conta só-Google (password: null)', () => {
    it('rejects password login with a Google-specific 401 message (Fase E / E1)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-google',
        email: 'g@example.com',
        password: null,
        emailVerified: true,
      });

      // A mensagem prova que o guard `!user.password` disparou ANTES do bcrypt:
      // `bcrypt.compare(x, null)` real lançaria "data and hash arguments
      // required", uma mensagem diferente. (bcrypt não é mockável aqui — é
      // binding nativo —, então a mensagem exata É a asserção do caminho.)
      await expect(
        service.login('g@example.com', 'anything'),
      ).rejects.toMatchObject({
        message:
          'Esta conta entra com o Google. Use o botão "Continuar com o Google" abaixo.',
      });
    });
  });

  describe('loginWithGoogle', () => {

    const validCredential = 'valid.google.jwt';

    beforeEach(() => {
      jwtService.sign
        .mockReturnValue('access-token')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      prisma.refreshSession.create.mockResolvedValue({});
    });

    // ---- verificação do id_token (A2) ----

    it('503 when GOOGLE_CLIENT_ID is not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;

      await expect(service.loginWithGoogle(validCredential)).rejects.toMatchObject({
        message: 'Login com Google indisponível no momento.',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('401 when the signature / token is invalid (verifyIdToken throws)', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

      await expect(service.loginWithGoogle(validCredential)).rejects.toMatchObject({
        message: 'Não foi possível validar seu login com o Google. Tente de novo.',
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.linkedAccount.create).not.toHaveBeenCalled();
    });

    it('401 when verifyIdToken rejects an expired token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Token used too late'));
      await expect(service.loginWithGoogle(validCredential)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('passes our client id as the audience to verifyIdToken', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('nope'));
      await service.loginWithGoogle(validCredential).catch(() => undefined);
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: validCredential,
        audience: 'test-google-client-id',
      });
    });

    it('401 when the issuer is not a Google issuer', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload({ iss: 'https://evil.example.com' }));

      await expect(service.loginWithGoogle(validCredential)).rejects.toMatchObject({
        message: 'Não foi possível validar seu login com o Google. Tente de novo.',
      });
    });

    it('401 (own message) and touches nothing when email_verified is false', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: false }));

      await expect(service.loginWithGoogle(validCredential)).rejects.toMatchObject({
        message:
          'Seu e-mail no Google não está verificado. Confirme seu e-mail na sua Conta Google e tente de novo — ou crie sua conta do Oratio com e-mail e senha.',
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.linkedAccount.create).not.toHaveBeenCalled();
    });

    it('401 when email_verified is missing entirely', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: undefined }));
      await expect(service.loginWithGoogle(validCredential)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    // ---- resolução de conta (A3) ----

    it('logs in directly when a LinkedAccount already exists for the sub', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      prisma.linkedAccount.findUnique.mockResolvedValue({
        userId: 'user-1',
        provider: 'google',
        providerAccountId: 'google-sub-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'fulano@example.com',
      });

      const result = await service.loginWithGoogle(validCredential);

      // login recorrente (E2): o vínculo já existia -> os dois flags false
      expect(result).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        isNewUser: false,
        googleLinkedNow: false,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.linkedAccount.create).not.toHaveBeenCalled();
    });

    it('creates a new User (no password, emailVerified true) + LinkedAccount for a new email', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      prisma.linkedAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user', email: 'fulano@example.com' });
      prisma.linkedAccount.create.mockResolvedValue({});

      const result = await service.loginWithGoogle(validCredential);

      expect(result.access_token).toBe('access-token');
      // cadastro novo via Google (E2)
      expect(result).toMatchObject({ isNewUser: true, googleLinkedNow: false });

      const userData = prisma.user.create.mock.calls[0][0].data;
      expect(userData).toMatchObject({
        name: 'Fulano de Tal',
        email: 'fulano@example.com',
        emailVerified: true,
        password: null,
      });

      const linkData = prisma.linkedAccount.create.mock.calls[0][0].data;
      expect(linkData).toMatchObject({
        userId: 'new-user',
        provider: 'google',
        providerAccountId: 'google-sub-1',
        emailSnapshot: 'fulano@example.com',
      });
    });

    it('auto-links an existing email+password account without touching password/name', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      prisma.linkedAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'fulano@example.com',
        emailVerified: true,
        password: 'existing-hash',
        name: 'Nome Editado No App',
      });
      prisma.linkedAccount.create.mockResolvedValue({});

      const result = await service.loginWithGoogle(validCredential);

      expect(result.access_token).toBe('access-token');
      // auto-ligação (E2): User já existia, vínculo criado agora
      expect(result).toMatchObject({ isNewUser: false, googleLinkedNow: true });
      expect(prisma.user.create).not.toHaveBeenCalled();
      // auto-link não mexe em password/name -> nenhum update (emailVerified já true)
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.linkedAccount.create.mock.calls[0][0].data.userId).toBe('existing-user');
    });

    it('A9 — flips emailVerified to true when auto-linking an unverified account', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      prisma.linkedAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'unverified-user',
        email: 'fulano@example.com',
        emailVerified: false,
        password: 'existing-hash',
      });
      prisma.linkedAccount.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      await service.loginWithGoogle(validCredential);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'unverified-user' },
        data: { emailVerified: true },
      });
    });

    it('A10 — recovers from a concurrent-signup P2002 by re-resolving to the winner', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      // 1ª resolução: nada existe
      prisma.linkedAccount.findUnique
        .mockResolvedValueOnce(null)
        // re-resolução após a corrida: o vínculo do vencedor já existe
        .mockResolvedValueOnce({ userId: 'winner', provider: 'google', providerAccountId: 'google-sub-1' });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // 1ª: sem User pra esse e-mail
        .mockResolvedValueOnce({ id: 'winner', email: 'fulano@example.com' }); // re-resolução

      const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.$transaction.mockRejectedValue(p2002);

      const result = await service.loginWithGoogle(validCredential);

      // corrida (E2): o vínculo do vencedor foi encontrado na re-resolução,
      // esta requisição não criou nada -> isNewUser false
      expect(result).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        isNewUser: false,
        googleLinkedNow: false,
      });
    });

    it('rethrows a non-P2002 error from the signup transaction', async () => {
      mockVerifyIdToken.mockResolvedValue(googlePayload());
      prisma.linkedAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('db down'));

      await expect(service.loginWithGoogle(validCredential)).rejects.toThrow('db down');
    });
  });
});
