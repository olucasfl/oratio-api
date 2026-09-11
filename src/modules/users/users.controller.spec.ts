import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UnauthorizedException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AdminGuard } from 'src/modules/auth/admin.guard';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      // ThrottlerGuard puxa THROTTLER:MODULE_OPTIONS de ThrottlerModule.forRoot(),
      // e AdminGuard depende de PrismaService de verdade — nenhum dos dois
      // existe nesse módulo de teste isolado. Fazer override de ambos evita
      // que o Nest tente resolver essas dependências reais ao compilar; o
      // que este teste quer confirmar é só que o controller instancia, não
      // testar rate limit ou permissão de admin de verdade (isso já é
      // coberto nos specs de cada guard).
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

/*
Instancia o controller direto (sem guards/DI) porque o que importa aqui é
só a lógica de cada rota: extrair req.user.userId (ou rejeitar com 401 se
faltar) e delegar pro UsersService com os argumentos certos. Guards já são
testados nos seus próprios specs (JwtAuthGuard, AdminGuard).
*/
describe('UsersController (delegation)', () => {
  let controller: UsersController;
  let userService: Record<string, jest.Mock>;

  beforeEach(() => {
    userService = {
      create: jest.fn(),
      getProfile: jest.fn(),
      acceptLegalTerms: jest.fn(),
      getAllUsers: jest.fn(),
      getUserDetail: jest.fn(),
      deleteUserAdmin: jest.fn(),
      getAdminStats: jest.fn(),
      getAdminTimeseries: jest.fn(),
      getActivityHeatmap: jest.fn(),
      setAdminStatus: jest.fn(),
      getUserActivity: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
      setPassword: jest.fn(),
      requestEmailChange: jest.fn(),
      cancelEmailChange: jest.fn(),
      getMySessions: jest.fn(),
      revokeMySession: jest.fn(),
      deleteAccount: jest.fn(),
    };

    controller = new UsersController(userService as any);
  });

  const authed = (userId = 'user-1') => ({ user: { userId } });
  const unauthed = { user: {} };

  it('create() forwards the body and the x-app header (no auth required)', () => {
    userService.create.mockReturnValue('create-result');

    const result = controller.create({ email: 'a@b.com' } as any, 'oratio');

    expect(userService.create).toHaveBeenCalledWith({ email: 'a@b.com' }, 'oratio');
    expect(result).toBe('create-result');
  });

  it('getProfile() rejects when the request has no userId', () => {
    expect(() => controller.getProfile(unauthed)).toThrow(UnauthorizedException);
    expect(userService.getProfile).not.toHaveBeenCalled();
  });

  it('getProfile() delegates with the authenticated userId', () => {
    userService.getProfile.mockReturnValue('profile');

    expect(controller.getProfile(authed('user-1'))).toBe('profile');
    expect(userService.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('getAllUsers() rejects without a userId', () => {
    expect(() => controller.getAllUsers(unauthed)).toThrow(UnauthorizedException);
  });

  it('getAllUsers() converts string query params into the typed filters object', () => {
    userService.getAllUsers.mockReturnValue('users');

    controller.getAllUsers(authed('admin-1'), 'maria', 'true', 'false', '30', 'google');

    expect(userService.getAllUsers).toHaveBeenCalledWith('admin-1', {
      search: 'maria',
      isAdmin: true,
      emailVerified: false,
      activeLastDays: 30,
      provider: 'google',
    });
  });

  it('getAllUsers() leaves filters undefined when no query params are given', () => {
    userService.getAllUsers.mockReturnValue('users');

    controller.getAllUsers(authed('admin-1'));

    expect(userService.getAllUsers).toHaveBeenCalledWith('admin-1', {
      search: undefined,
      isAdmin: undefined,
      emailVerified: undefined,
      activeLastDays: undefined,
      provider: undefined,
    });
  });

  it('getAllUsers() passes provider oratio/google/both through and ignores anything else', () => {
    userService.getAllUsers.mockReturnValue('users');

    for (const value of ['oratio', 'google', 'both']) {
      controller.getAllUsers(authed('admin-1'), undefined, undefined, undefined, undefined, value);
      expect(userService.getAllUsers).toHaveBeenLastCalledWith(
        'admin-1',
        expect.objectContaining({ provider: value }),
      );
    }

    controller.getAllUsers(authed('admin-1'), undefined, undefined, undefined, undefined, 'banana');
    expect(userService.getAllUsers).toHaveBeenLastCalledWith(
      'admin-1',
      expect.objectContaining({ provider: undefined }),
    );
  });

  it('getUserDetail() rejects without a userId', () => {
    expect(() => controller.getUserDetail(unauthed, 'target-1')).toThrow(
      UnauthorizedException,
    );
  });

  it('getUserDetail() delegates with the admin id and the target id', () => {
    userService.getUserDetail.mockReturnValue('detail');

    controller.getUserDetail(authed('admin-1'), 'target-1');

    expect(userService.getUserDetail).toHaveBeenCalledWith('admin-1', 'target-1');
  });

  it('deleteUser() rejects without a userId', () => {
    expect(() => controller.deleteUser(unauthed, 'target-1')).toThrow(UnauthorizedException);
  });

  it('deleteUser() delegates to deleteUserAdmin with admin id and target id', () => {
    userService.deleteUserAdmin.mockReturnValue('deleted');

    controller.deleteUser(authed('admin-1'), 'target-1');

    expect(userService.deleteUserAdmin).toHaveBeenCalledWith('admin-1', 'target-1');
  });

  it('getAdminStats() rejects without a userId', () => {
    expect(() => controller.getAdminStats(unauthed)).toThrow(UnauthorizedException);
  });

  it('getAdminStats() delegates with the caller id', () => {
    userService.getAdminStats.mockReturnValue('stats');

    controller.getAdminStats(authed('admin-1'));

    expect(userService.getAdminStats).toHaveBeenCalledWith('admin-1');
  });

  it('getAdminTimeseries() rejects without a userId', () => {
    expect(() => controller.getAdminTimeseries(unauthed)).toThrow(UnauthorizedException);
  });

  it('getAdminTimeseries() defaults metric to "users" and range to "6m" when omitted', () => {
    userService.getAdminTimeseries.mockReturnValue('series');

    controller.getAdminTimeseries(authed('admin-1'));

    expect(userService.getAdminTimeseries).toHaveBeenCalledWith('admin-1', 'users', '6m');
  });

  it('getAdminTimeseries() forwards explicit metric/range', () => {
    userService.getAdminTimeseries.mockReturnValue('series');

    controller.getAdminTimeseries(authed('admin-1'), 'rosaries', '30d');

    expect(userService.getAdminTimeseries).toHaveBeenCalledWith('admin-1', 'rosaries', '30d');
  });

  it('getActivityHeatmap() rejects without a userId', () => {
    expect(() => controller.getActivityHeatmap(unauthed)).toThrow(UnauthorizedException);
  });

  it('getActivityHeatmap() defaults metric to "logins" and days to 90 when omitted', () => {
    userService.getActivityHeatmap.mockReturnValue('heatmap');

    controller.getActivityHeatmap(authed('admin-1'));

    expect(userService.getActivityHeatmap).toHaveBeenCalledWith('admin-1', 'logins', 90);
  });

  it('getActivityHeatmap() parses an explicit days query param to a number', () => {
    userService.getActivityHeatmap.mockReturnValue('heatmap');

    controller.getActivityHeatmap(authed('admin-1'), 'prayers', '30');

    expect(userService.getActivityHeatmap).toHaveBeenCalledWith('admin-1', 'prayers', 30);
  });

  it('setAdminStatus() rejects without a userId', () => {
    expect(() =>
      controller.setAdminStatus(unauthed, 'target-1', { isAdmin: true, adminPassword: 'x' }),
    ).toThrow(UnauthorizedException);
  });

  it('setAdminStatus() forwards caller id, target id, isAdmin and adminPassword', () => {
    userService.setAdminStatus.mockReturnValue('updated');

    controller.setAdminStatus(authed('admin-1'), 'target-1', {
      isAdmin: true,
      adminPassword: 'secret',
    });

    expect(userService.setAdminStatus).toHaveBeenCalledWith(
      'admin-1',
      'target-1',
      true,
      'secret',
    );
  });

  it('getUserActivity() rejects without a userId', () => {
    expect(() => controller.getUserActivity(unauthed, 'target-1')).toThrow(
      UnauthorizedException,
    );
  });

  it('getUserActivity() delegates with admin id and target id', () => {
    userService.getUserActivity.mockReturnValue('activity');

    controller.getUserActivity(authed('admin-1'), 'target-1');

    expect(userService.getUserActivity).toHaveBeenCalledWith('admin-1', 'target-1');
  });

  it('acceptLegalTerms() rejects without a userId', () => {
    expect(() => controller.acceptLegalTerms(unauthed)).toThrow(UnauthorizedException);
    expect(userService.acceptLegalTerms).not.toHaveBeenCalled();
  });

  it('acceptLegalTerms() delegates with the authenticated userId', () => {
    userService.acceptLegalTerms.mockReturnValue({ ok: true });

    expect(controller.acceptLegalTerms(authed('user-1'))).toEqual({ ok: true });
    expect(userService.acceptLegalTerms).toHaveBeenCalledWith('user-1');
  });

  it('updateProfile() rejects without a userId', () => {
    expect(() => controller.updateProfile(unauthed, { name: 'Maria' })).toThrow(
      UnauthorizedException,
    );
  });

  it('updateProfile() delegates with the new name', () => {
    userService.updateProfile.mockReturnValue('updated');

    controller.updateProfile(authed('user-1'), { name: 'Maria' });

    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', 'Maria');
  });

  it('changePassword() rejects without a userId', () => {
    expect(() =>
      controller.changePassword(unauthed, { currentPassword: 'a', newPassword: 'b' } as any),
    ).toThrow(UnauthorizedException);
  });

  it('changePassword() delegates current and new password', () => {
    userService.changePassword.mockReturnValue('changed');

    controller.changePassword(authed('user-1'), {
      currentPassword: 'CorrectPass123',
      newPassword: 'NewPass123',
    } as any);

    expect(userService.changePassword).toHaveBeenCalledWith(
      'user-1',
      'CorrectPass123',
      'NewPass123',
    );
  });

  it('setPassword() rejects without a userId', () => {
    expect(() =>
      controller.setPassword(unauthed, { password: 'BrandNew123', confirmPassword: 'BrandNew123' } as any),
    ).toThrow(UnauthorizedException);
  });

  it('setPassword() delegates password and confirmation', () => {
    userService.setPassword.mockReturnValue('set');

    controller.setPassword(authed('user-1'), {
      password: 'BrandNew123',
      confirmPassword: 'BrandNew123',
    } as any);

    expect(userService.setPassword).toHaveBeenCalledWith(
      'user-1',
      'BrandNew123',
      'BrandNew123',
    );
  });

  it('requestEmailChange() rejects without a userId', () => {
    expect(() =>
      controller.requestEmailChange(unauthed, { email: 'a@b.com' } as any, 'oratio'),
    ).toThrow(UnauthorizedException);
  });

  it('requestEmailChange() delegates the new email and x-app header', () => {
    userService.requestEmailChange.mockReturnValue('pending');

    controller.requestEmailChange(authed('user-1'), { email: 'new@example.com' } as any, 'oratio');

    expect(userService.requestEmailChange).toHaveBeenCalledWith(
      'user-1',
      'new@example.com',
      'oratio',
    );
  });

  it('cancelEmailChange() rejects without a userId', () => {
    expect(() => controller.cancelEmailChange(unauthed)).toThrow(UnauthorizedException);
  });

  it('cancelEmailChange() delegates with the userId', () => {
    userService.cancelEmailChange.mockReturnValue('cancelled');

    controller.cancelEmailChange(authed('user-1'));

    expect(userService.cancelEmailChange).toHaveBeenCalledWith('user-1');
  });

  it('getMySessions() rejects without a userId', () => {
    expect(() => controller.getMySessions(unauthed)).toThrow(UnauthorizedException);
  });

  it('getMySessions() delegates with the userId', () => {
    userService.getMySessions.mockReturnValue('sessions');

    controller.getMySessions(authed('user-1'));

    expect(userService.getMySessions).toHaveBeenCalledWith('user-1');
  });

  it('revokeMySession() rejects without a userId', () => {
    expect(() => controller.revokeMySession(unauthed, 'session-1')).toThrow(
      UnauthorizedException,
    );
  });

  it('revokeMySession() delegates the userId and sessionId', () => {
    userService.revokeMySession.mockReturnValue('revoked');

    controller.revokeMySession(authed('user-1'), 'session-1');

    expect(userService.revokeMySession).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('deleteAccount() rejects without a userId', () => {
    expect(() => controller.deleteAccount(unauthed, { password: 'x' } as any)).toThrow(
      UnauthorizedException,
    );
  });

  it('deleteAccount() delegates the userId and the identity proof (password + googleCredential)', () => {
    userService.deleteAccount.mockReturnValue('deleted');

    controller.deleteAccount(authed('user-1'), {
      password: 'CorrectPass123',
      googleCredential: undefined,
    } as any);

    expect(userService.deleteAccount).toHaveBeenCalledWith('user-1', {
      password: 'CorrectPass123',
      googleCredential: undefined,
    });
  });
});
