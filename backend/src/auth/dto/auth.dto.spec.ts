import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

describe('authentication DTOs', () => {
  it('rejects malformed email and passwords that do not meet minimum length', async () => {
    const dto = Object.assign(new RegisterDto(), {
      email: 'bad-email',
      password: 'short',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('rejects privileged roles and all unexpected fields when whitelist validation is enabled', async () => {
    const dto = Object.assign(new RegisterDto(), {
      email: 'user@example.com',
      password: 'long-enough-password',
      role: 'ADMIN',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'role')).toBe(true);
  });

  it('requires email and password on login', async () => {
    const errors = await validate(new LoginDto());
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});
