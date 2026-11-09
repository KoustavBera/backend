import { cors } from "hono/cors";
import { config } from "../config";

const allowedOrigins = new Set([
  config.FRONTEND_URL.replace(/\/$/, ""),
  ...(config.NODE_ENV === "development"
    ? [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
      ]
    : []),
]);

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return config.FRONTEND_URL;
    const cleanOrigin = origin.replace(/\/$/, "");
    if (allowedOrigins.has(cleanOrigin)) {
      return origin;
    }
    return null;
  },
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposeHeaders: ["Content-Length"],
  maxAge: 86400,
});

