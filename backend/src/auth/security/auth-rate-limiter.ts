import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type AttemptWindow = { count: number; expiresAt: number };

@Injectable()
export class AuthRateLimiter {
  private readonly windows = new Map<string, AttemptWindow>();

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): void {
    const current = this.windows.get(key);
    if (!current || now >= current.expiresAt) {
      this.windows.set(key, { count: 1, expiresAt: now + windowMs });
      if (this.windows.size > 10_000) this.prune(now);
      return;
    }
    if (current.count >= limit) {
      throw new HttpException(
        'Too many authentication attempts.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    current.count += 1;
    if (this.windows.size > 10_000) this.prune(now);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.expiresAt) this.windows.delete(key);
    }
  }
}
