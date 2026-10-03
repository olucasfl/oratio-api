import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from 'src/modules/auth/admin.guard';
import { JwtAuthGuard } from 'src/modules/auth/jwt-auth.guard';
import { PoteController } from './pote.controller';

const service: Record<string, jest.Mock> = {
  createRoom: jest.fn(),
  listMine: jest.fn(),
  searchUsers: jest.fn(),
  invite: jest.fn(),
  changePhase: jest.fn(),
  setPaused: jest.fn(),
  extend: jest.fn(),
  removePlayer: jest.fn(),
  cancel: jest.fn(),
  getState: jest.fn(),
  join: jest.fn(),
  tutorialDone: jest.fn(),
  round1Action: jest.fn(),
  round2Place: jest.fn(),
  round2Sync: jest.fn(),
  round2Remove: jest.fn(),
  round2Finish: jest.fn(),
  saveCommitment: jest.fn(),
};
const controller = new PoteController(service as any);
const req = { user: { userId: 'user-1' } };

beforeEach(() => Object.values(service).forEach((fn) => fn.mockReset()));

const guardsOf = (method: keyof PoteController): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, PoteController.prototype[method]) ?? [];

describe('PoteController — guards', () => {
  it('toda a classe exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PoteController)).toContain(JwtAuthGuard);
  });

  it.each([
    'createRoom',
    'listMine',
    'searchUsers',
    'invite',
    'phase',
    'pause',
    'extend',
    'removePlayer',
    'cancel',
  ] as const)('%s é só de admin (AdminGuard)', (method) => {
    expect(guardsOf(method)).toContain(AdminGuard);
  });

  it.each([
    'getState',
    'join',
    'tutorialDone',
    'round1Action',
    'round2Place',
    'round2Sync',
    'round2Remove',
    'round2Finish',
    'commitment',
  ] as const)('%s é de jogador: sem AdminGuard (o convite é conferido no service)', (method) => {
    expect(guardsOf(method)).not.toContain(AdminGuard);
  });
});

describe('PoteController — delegação', () => {
  it('round2Sync manda a lista e o userId do token', () => {
    controller.round2Sync(req, '1234', { placed: ['oracao', 'reels'] });
    expect(service.round2Sync).toHaveBeenCalledWith('1234', 'user-1', ['oracao', 'reels']);
  });

  it('usa o userId do token, nunca do body', () => {
    controller.round1Action(req, '1234', { index: 0, action: 'TAKE' });
    expect(service.round1Action).toHaveBeenCalledWith('1234', 'user-1', 0, 'TAKE');
  });

  it('código que não tem 4 dígitos → 404 sem tocar no service', () => {
    for (const bad of ['mine', '12', '12345', 'abcd', '12 4']) {
      expect(() => controller.getState(req, bad)).toThrow(NotFoundException);
    }
    expect(service.getState).not.toHaveBeenCalled();
  });

  it('?since numérico inteiro é repassado; lixo vira undefined', () => {
    controller.getState(req, '1234', '7');
    expect(service.getState).toHaveBeenLastCalledWith('1234', 'user-1', 7);
    controller.getState(req, '1234', 'abc');
    expect(service.getState).toHaveBeenLastCalledWith('1234', 'user-1', undefined);
    controller.getState(req, '1234', '1.5');
    expect(service.getState).toHaveBeenLastCalledWith('1234', 'user-1', undefined);
    controller.getState(req, '1234');
    expect(service.getState).toHaveBeenLastCalledWith('1234', 'user-1', undefined);
  });

  it('rotas de líder passam o userId do token como líder', () => {
    controller.phase(req, '1234', { to: 'ROUND_1' });
    expect(service.changePhase).toHaveBeenCalledWith('1234', 'user-1', 'ROUND_1');
    controller.pause(req, '1234', { paused: true });
    expect(service.setPaused).toHaveBeenCalledWith('1234', 'user-1', true);
    controller.removePlayer(req, '1234', 'alvo');
    expect(service.removePlayer).toHaveBeenCalledWith('1234', 'user-1', 'alvo');
    controller.invite(req, '1234', { userIds: ['a'] });
    expect(service.invite).toHaveBeenCalledWith('1234', 'user-1', ['a']);
  });
});
