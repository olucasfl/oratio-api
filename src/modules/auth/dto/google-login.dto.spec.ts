import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GoogleLoginDto } from './google-login.dto';

function errorsFor(payload: unknown) {
  return validateSync(plainToInstance(GoogleLoginDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('GoogleLoginDto', () => {
  it('accepts a non-empty credential string', () => {
    expect(errorsFor({ credential: 'header.payload.signature' })).toHaveLength(0);
  });

  it('rejects a missing, empty or non-string credential', () => {
    expect(errorsFor({}).length).toBeGreaterThan(0);
    expect(errorsFor({ credential: '' }).length).toBeGreaterThan(0);
    expect(errorsFor({ credential: 123 }).length).toBeGreaterThan(0);
  });

  it('rejects an unexpected extra field (e.g. a re-added nonce)', () => {
    expect(
      errorsFor({ credential: 'abc', nonce: 'x' }).length,
    ).toBeGreaterThan(0);
  });
});
