import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SetPasswordDto } from './set-password.dto';

// Mesmas opções do ValidationPipe global (main.ts).
function errorsFor(payload: unknown) {
  return validateSync(plainToInstance(SetPasswordDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

const valid = {
  password: 'BrandNew123',
  confirmPassword: 'BrandNew123',
  googleCredential: 'fresh.google.id-token',
};

describe('SetPasswordDto', () => {
  it('accepts password + confirmPassword + googleCredential', () => {
    expect(errorsFor(valid)).toHaveLength(0);
  });

  it('rejects a missing googleCredential (prova de identidade obrigatória) with a Portuguese message', () => {
    const { googleCredential, ...withoutCredential } = valid;
    const errors = errorsFor(withoutCredential);

    const credentialError = errors.find((e) => e.property === 'googleCredential');
    expect(credentialError).toBeDefined();
    expect(Object.values(credentialError!.constraints ?? {})).toContain(
      'Confirme sua identidade entrando com o Google.',
    );
  });

  it('rejects an empty googleCredential', () => {
    const errors = errorsFor({ ...valid, googleCredential: '' });
    expect(errors.some((e) => e.property === 'googleCredential')).toBe(true);
  });

  it('rejects a non-string googleCredential', () => {
    const errors = errorsFor({ ...valid, googleCredential: 123 });
    expect(errors.some((e) => e.property === 'googleCredential')).toBe(true);
  });

  it('still validates the password rules', () => {
    expect(errorsFor({ ...valid, password: 'short1', confirmPassword: 'short1' }).length).toBeGreaterThan(0);
  });
});
