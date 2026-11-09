import { Hono } from "hono";
import { prisma } from "../db/prisma";
import { checkRedisHealth } from "../db/redis";
import type { AppEnv } from "../types/context";

const health = new Hono<AppEnv>();

// Liveness check - returns 200 if the Node/Bun process is running and accepting requests
health.get("/live", (c) => {
  return c.json({ status: "ok" }, 200);
});

// Readiness check - validates DB and Redis dependencies
health.get("/ready", async (c) => {
  const uptime = Math.floor(process.uptime());
  let dbStatus: "ok" | "error" = "ok";

  try {
    // Fast ping query to verify database connectivity and pooler status
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("Database readiness check failed:", (err as Error).message);
    dbStatus = "error";
  }

  const redisStatus = await checkRedisHealth();

  if (dbStatus === "error") {
    return c.json(
      {
        status: "unhealthy",
        db: "error",
        redis: redisStatus,
        uptime,
      },
      503
    );
  }

  if (redisStatus === "degraded") {
    // Redis degradation falls back to in-memory rate limiting; does NOT cause container restarts
    return c.json(
      {
        status: "degraded",
        db: "ok",
        redis: "degraded",
        uptime,
      },
      200
    );
  }

  return c.json(
    {
      status: "ok",
      db: "ok",
      redis: "ok",
      uptime,
    },
    200
  );
});

export { health };
