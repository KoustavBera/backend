import { Redis } from "@upstash/redis";
import { config } from "../config";

let redisClient: Redis | null = null;

const isValidUrl = (urlStr: string) => {
  try {
    const url = new URL(urlStr);
    return url.protocol === "https:" && !urlStr.includes("example.upstash.io");
  } catch {
    return false;
  }
};

if (
  config.UPSTASH_REDIS_REST_URL &&
  config.UPSTASH_REDIS_REST_TOKEN &&
  isValidUrl(config.UPSTASH_REDIS_REST_URL)
) {
  redisClient = new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
  });
}

export const redis = redisClient;

export async function checkRedisHealth(): Promise<"ok" | "degraded"> {
  if (!redis) {
    return "degraded";
  }
  try {
    const pingResult = await redis.ping();
    return pingResult === "PONG" ? "ok" : "degraded";
  } catch (err) {
    console.warn("⚠️ Redis health check failed (operating degraded):", (err as Error).message);
    return "degraded";
  }
}

