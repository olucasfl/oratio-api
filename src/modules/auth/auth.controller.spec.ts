import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

jest.mock('./utils/session-info.util', () => ({
  getClientIp: jest.fn(() => '203.0.113.7'),
}));

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    })
      // ThrottlerGuard puxa THROTTLER:MODULE_OPTIONS de ThrottlerModule.forRoot(),
      // que não existe nesse módulo de teste isolado — esse teste só quer
      // confirmar que o controller instancia, não testar rate limit de verdade.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

/*
Os testes abaixo instanciam o controller direto (sem TestingModule) porque
o que importa aqui é só a lógica de delegação de cada rota pro AuthService
com os argumentos certos — guards/throttling não fazem parte do que essas
rotas decidem fazer.
*/
describe('AuthController (delegation)', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;

  beforeEach(() => {
    authService = {
      login: jest.fn(),
      loginWithGoogle: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      verifyEmail: jest.fn(),
      confirmEmailToken: jest.fn(),
      resendVerification: jest.fn(),
      checkVerification: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      confirmEmailChange: jest.fn(),
    };

    controller = new AuthController(authService as any, {} as any);
  });

  it('login() passes credentials plus the extracted user agent and IP', () => {
    const req = { headers: { 'user-agent': 'Mozilla/5.0' } };
    authService.login.mockReturnValue('login-result');

    const result = controller.login(
      { email: 'user@example.com', password: 'secret' } as any,
      req,
    );

    expect(authService.login).toHaveBeenCalledWith('user@example.com', 'secret', {
      userAgent: 'Mozilla/5.0',
      ipAddress: '203.0.113.7',
    });
    expect(result).toBe('login-result');
  });

  it('loginWithGoogle() passes the credential plus the extracted user agent and IP', () => {
    const req = { headers: { 'user-agent': 'Mozilla/5.0' } };
    authService.loginWithGoogle.mockReturnValue('google-result');

    const result = controller.loginWithGoogle(
      { credential: 'google.id.token' } as any,
      req,
    );

    expect(authService.loginWithGoogle).toHaveBeenCalledWith('google.id.token', {
      userAgent: 'Mozilla/5.0',
      ipAddress: '203.0.113.7',
    });
    expect(result).toBe('google-result');
  });

  it('refresh() passes through the refresh token', () => {
    authService.refresh.mockReturnValue('refresh-result');

    const result = controller.refresh({ refresh_token: 'rt-1' } as any);

    expect(authService.refresh).toHaveBeenCalledWith('rt-1');
    expect(result).toBe('refresh-result');
  });

  it('logout() revokes the session and always reports success', async () => {
    authService.logout.mockResolvedValue(undefined);

    const result = await controller.logout({ refresh_token: 'rt-1' } as any);

    expect(authService.logout).toHaveBeenCalledWith('rt-1');
    expect(result).toEqual({ message: 'Logged out' });
  });

  it('verifyEmail() (GET, legacy redirect) forwards token, app and the response object', () => {
    const res = { redirect: jest.fn() } as any;
    authService.verifyEmail.mockReturnValue('verify-result');

    const result = controller.verifyEmail('tok', 'oratio', res);

    expect(authService.verifyEmail).toHaveBeenCalledWith('tok', 'oratio', res);
    expect(result).toBe('verify-result');
  });

  it('confirmEmail() (POST, JSON) calls the idempotent token confirmation', () => {
    authService.confirmEmailToken.mockReturnValue('confirm-result');

    const result = controller.confirmEmail({ token: 'tok' } as any);

    expect(authService.confirmEmailToken).toHaveBeenCalledWith('tok');
    expect(result).toBe('confirm-result');
  });

  it('resendVerification() forwards the email and the x-app header', () => {
    authService.resendVerification.mockReturnValue('resend-result');

    const result = controller.resendVerification({ email: 'user@example.com' } as any, 'oratio');

    expect(authService.resendVerification).toHaveBeenCalledWith('user@example.com', 'oratio');
    expect(result).toBe('resend-result');
  });

  it('checkVerification() forwards the email query param', () => {
    authService.checkVerification.mockReturnValue('check-result');

    const result = controller.checkVerification('user@example.com');

    expect(authService.checkVerification).toHaveBeenCalledWith('user@example.com');
    expect(result).toBe('check-result');
  });

  it('forgotPassword() forwards the email and the x-app header', () => {
    authService.requestPasswordReset.mockReturnValue('forgot-result');

    const result = controller.forgotPassword({ email: 'user@example.com' } as any, 'oratio');

    expect(authService.requestPasswordReset).toHaveBeenCalledWith('user@example.com', 'oratio');
    expect(result).toBe('forgot-result');
  });

  it('resetPassword() forwards the token and the new password', () => {
    authService.resetPassword.mockReturnValue('reset-result');

    const result = controller.resetPassword({ token: 'tok', password: 'NewPass123' } as any);

    expect(authService.resetPassword).toHaveBeenCalledWith('tok', 'NewPass123');
    expect(result).toBe('reset-result');
  });

  it('confirmEmailChange() forwards the confirmation token', () => {
    authService.confirmEmailChange.mockReturnValue('change-result');

    const result = controller.confirmEmailChange({ token: 'tok' } as any);

    expect(authService.confirmEmailChange).toHaveBeenCalledWith('tok');
    expect(result).toBe('change-result');
  });
});
