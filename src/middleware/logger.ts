import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/context";

export const requestLogger = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);

    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Math.round((performance.now() - start) * 100) / 100;
    const status = c.res.status;

    // Zero PII log line
    const logLine = `[${new Date().toISOString()}] ${requestId.slice(0, 8)} ${method} ${path} -> ${status} (${duration}ms)`;

    if (status >= 500) {
      console.error(`❌ ${logLine}`);
    } else if (status >= 400) {
      console.warn(`⚠️ ${logLine}`);
    } else {
      console.log(`ℹ️ ${logLine}`);
    }
  };
};
