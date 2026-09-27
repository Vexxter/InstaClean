/**
 * Rate limiting utilities for Instagram API calls.
 *
 * See RATE_LIMITS below for the per-endpoint delay/burst-pause values.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep, reporting the remaining time about once a second. */
export async function sleepWithTicks(
  ms: number,
  onTick?: (remainingMs: number) => void,
): Promise<void> {
  const endsAt = Date.now() + ms;
  let remaining = ms;

  while (remaining > 0) {
    onTick?.(remaining);
    await sleep(Math.min(1000, remaining));
    remaining = endsAt - Date.now();
  }
}

export interface RateLimitConfig {
  /** Delay between individual requests (ms) */
  delayMs: number;
  /** Max delay jitter added on top of delayMs */
  jitterMs: number;
  /** Number of requests before a long pause */
  burstSize: number;
  /** Duration of the long pause (ms) */
  burstPauseMs: number;
}

export const RATE_LIMITS = {
  scan: {
    delayMs: 1000,
    jitterMs: 200,
    burstSize: 6,
    burstPauseMs: 10_000,
  } satisfies RateLimitConfig,

  verify: {
    delayMs: 800,
    jitterMs: 200,
    burstSize: 80,
    burstPauseMs: 15_000,
  } satisfies RateLimitConfig,

  unfollow: {
    delayMs: 2000,
    jitterMs: 1000,
    burstSize: 30,
    burstPauseMs: 60_000,
  } satisfies RateLimitConfig,
};

/**
 * Creates a rate-limited executor that respects burst pauses.
 */
export function createRateLimiter(config: RateLimitConfig) {
  let requestCount = 0;

  return async function rateLimitedWait(
    onTick?: (remainingMs: number) => void,
  ): Promise<void> {
    requestCount++;

    if (requestCount > 1 && requestCount % config.burstSize === 1) {
      // Burst pause
      await sleepWithTicks(config.burstPauseMs, onTick);
    } else if (requestCount > 1) {
      // Normal delay with jitter
      await sleepWithTicks(config.delayMs + Math.random() * config.jitterMs, onTick);
    }
  };
}
