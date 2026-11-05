import { HttpException } from '@nestjs/common';
import { AuthRateLimiter } from './auth-rate-limiter';

describe('AuthRateLimiter', () => {
  it('limits repeated authentication attempts within a window and resets after success', () => {
    const limiter = new AuthRateLimiter();
    limiter.consume('hashed-key', 2, 60_000, 10);
    limiter.consume('hashed-key', 2, 60_000, 11);
    expect(() => limiter.consume('hashed-key', 2, 60_000, 12)).toThrow(
      HttpException,
    );
    limiter.reset('hashed-key');
    expect(() => limiter.consume('hashed-key', 2, 60_000, 13)).not.toThrow();
  });
});
