import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

function errorsFor(payload: unknown) {
  return validateSync(plainToInstance(CreateUserDto, payload));
}

const validBase = {
  name: 'Maria',
  email: 'maria@example.com',
  password: 'ValidPass123',
  confirmPassword: 'ValidPass123',
};

describe('CreateUserDto — legalTermsAccepted', () => {
  it('accepts legalTermsAccepted: true', () => {
    expect(errorsFor({ ...validBase, legalTermsAccepted: true })).toHaveLength(0);
  });

  it('rejects a missing legalTermsAccepted', () => {
    const errors = errorsFor({ ...validBase });
    expect(errors.some((e) => e.property === 'legalTermsAccepted')).toBe(true);
  });

  it('rejects legalTermsAccepted: false', () => {
    const errors = errorsFor({ ...validBase, legalTermsAccepted: false });
    expect(errors.some((e) => e.property === 'legalTermsAccepted')).toBe(true);
  });

  it('rejects legalTermsAccepted as the string "true"', () => {
    const errors = errorsFor({ ...validBase, legalTermsAccepted: 'true' });
    expect(errors.some((e) => e.property === 'legalTermsAccepted')).toBe(true);
  });

  it('rejects legalTermsAccepted: 1', () => {
    const errors = errorsFor({ ...validBase, legalTermsAccepted: 1 });
    expect(errors.some((e) => e.property === 'legalTermsAccepted')).toBe(true);
  });
});
