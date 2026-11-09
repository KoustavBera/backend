import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { config } from "./config";
import { AppError } from "./lib/errors";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/logger";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { study } from "./routes/study";
import { newsRouter } from "./routes/news";
import { announcementsRouter } from "./routes/announcements";
import { facultyRouter } from "./routes/faculty";
import { galleryRouter } from "./routes/gallery";
import { CleanupService } from "./services/cleanup.service";
import type { AppEnv } from "./types/context";

const app = new Hono<AppEnv>();

// Start in-process R2 pending deletions & expired intents worker
if (config.NODE_ENV !== "test") {
  CleanupService.startWorker();
}

// 1. Security headers (sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.)
app.use("*", secureHeaders());

// 2. CORS with exact origin validation
app.use("*", corsMiddleware);

// 3. Structured Request Logger with zero PII exposure
app.use("*", requestLogger());

// 4. API Routes
app.get("/", (c) => {
  return c.json({
    name: "Durgapur High School API",
    version: "1.0.0",
    status: "active",
    healthCheck: "/api/health/ready",
  });
});

app.route("/api/health", health);
app.route("/api/auth", auth);
app.route("/api/study", study);
app.route("/api/news", newsRouter);
app.route("/api/announcements", announcementsRouter);
app.route("/api/faculty", facultyRouter);
app.route("/api/gallery", galleryRouter);

// 5. 404 Not Found Handler (Standard Envelope)
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${c.req.method} ${c.req.path}`,
      },
    },
    404
  );
});

// 6. Global Error Handler (Standard Envelope)
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.statusCode as any
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues,
        },
      },
      400
    );
  }

  const requestId = c.get("requestId") || "unknown";
  console.error(`💥 Unhandled Exception [${requestId}]:`, err);

  return c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          config.NODE_ENV === "production"
            ? "An unexpected internal error occurred"
            : (err as Error).message || "Internal Server Error",
      },
    },
    500
  );
});

console.log(`🏫 Durgapur High School API running on port ${config.PORT} [${config.NODE_ENV}]`);

export default {
  port: config.PORT,
  fetch: app.fetch,
};
