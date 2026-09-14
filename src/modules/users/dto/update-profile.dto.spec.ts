import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateProfileDto } from './update-profile.dto';

function errorsFor(payload: unknown) {
  return validateSync(plainToInstance(UpdateProfileDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('UpdateProfileDto', () => {
  it('accepts a valid name', () => {
    expect(errorsFor({ name: 'Maria' })).toHaveLength(0);
  });

  it('trims surrounding whitespace before validating length', () => {
    const instance = plainToInstance(UpdateProfileDto, { name: '  Maria  ' });
    expect(instance.name).toBe('Maria');
    expect(validateSync(instance)).toHaveLength(0);
  });

  it('rejects a missing name', () => {
    expect(errorsFor({}).length).toBeGreaterThan(0);
  });

  it('rejects a name shorter than 2 characters (including whitespace-only)', () => {
    expect(errorsFor({ name: 'A' }).length).toBeGreaterThan(0);
    expect(errorsFor({ name: '   ' }).length).toBeGreaterThan(0);
  });

  it('rejects a name longer than 80 characters', () => {
    expect(errorsFor({ name: 'A'.repeat(81) }).length).toBeGreaterThan(0);
  });

  it('rejects a non-string name', () => {
    expect(errorsFor({ name: 123 }).length).toBeGreaterThan(0);
  });

  it('rejects an unexpected extra field', () => {
    expect(errorsFor({ name: 'Maria', isAdmin: true }).length).toBeGreaterThan(0);
  });
});
