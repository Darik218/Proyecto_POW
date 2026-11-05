import * as argon2 from 'argon2';
import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  it('stores passwords using Argon2id and verifies without exposing plaintext', async () => {
    const hasher = new PasswordHasher();
    const password = 'very-long-password';
    const hash = await hasher.hash(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(hash, password)).toBe(true);
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });

  it('performs an Argon2 verification for unknown accounts to reduce login timing differences', async () => {
    const hasher = new PasswordHasher();
    await expect(
      hasher.verifyUnknownAccount('wrong-password'),
    ).resolves.toBeUndefined();
  });
});
