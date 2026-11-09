import type { MiddlewareHandler } from "hono";
import { redis } from "../db/redis";
import { AppError } from "../lib/errors";
import { config } from "../config";
import type { AppEnv } from "../types/context";

type RateLimitOptions = {
  windowSeconds: number;
  maxRequests: number;
  prefix: string;
  failClosed?: boolean;
};

// In-memory sliding window fallback for development or when Redis is unreachable
const memoryStore = new Map<string, { count: number; expiresAt: number }>();

function checkInMemory(key: string, windowSeconds: number, maxRequests: number): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.expiresAt <= now) {
    memoryStore.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const { windowSeconds, maxRequests, prefix, failClosed = false } = options;

  return async (c, next) => {
    // In test environment, bypass rate limits so test suites don't step on each other
    if (config.NODE_ENV === "test") {
      return next();
    }

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";

    const key = `rl:${prefix}:${ip}`;

    if (!redis) {
      // Redis is not configured or in dev fallback
      const allowed = checkInMemory(key, windowSeconds, maxRequests);
      if (!allowed) {
        throw AppError.rateLimited();
      }
      return next();
    }

    try {
      // Upstash Redis sliding window / multi-exec rate limiting
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      c.header("X-RateLimit-Limit", maxRequests.toString());
      c.header("X-RateLimit-Remaining", Math.max(0, maxRequests - current).toString());

      if (current > maxRequests) {
        throw AppError.rateLimited();
      }

      await next();
    } catch (err) {
      if (err instanceof AppError) throw err;

      console.warn("⚠️ Rate limiting Redis error:", (err as Error).message);
      if (failClosed && config.NODE_ENV === "production") {
        throw AppError.rateLimited("Service temporarily unavailable, please retry shortly");
      }
      // Fail-open or fallback to in-memory check
      const fallbackAllowed = checkInMemory(key, windowSeconds, maxRequests);
      if (!fallbackAllowed) {
        throw AppError.rateLimited();
      }
      await next();
    }
  };
}

/**
 * Admissions rate limiter: 5 enquiries per 15 minutes per IP (strict fail-open)
 */
export const admissionsRateLimiter = rateLimit({
  windowSeconds: 15 * 60,
  maxRequests: 5,
  prefix: "admissions",
  failClosed: false,
});


