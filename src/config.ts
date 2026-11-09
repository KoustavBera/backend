import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  // Authentication secrets
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters long")
    .default("default-dev-access-token-secret-change-in-production"),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(16, "REFRESH_TOKEN_SECRET must be at least 16 characters long")
    .default("default-dev-refresh-token-secret-change-in-production"),

  // Server
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  COOKIE_DOMAIN: z.string().optional().default(""),

  // Redis (Upstash) - optional for local dev, rate limiting only
  UPSTASH_REDIS_REST_URL: z.string().optional().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(""),

  // Cloudflare R2 (Phase 4)
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET: z.string().default("durg-uploads"),
  R2_PUBLIC_URL: z.string().optional().default(""),

  // Resend Email (Phase 2 & 6)
  RESEND_API_KEY: z.string().optional().default(""),
});

const parseEnv = () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    for (const error of parsed.error.issues) {
      console.error(`   - ${error.path.join(".")}: ${error.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
};

export const config = parseEnv();
export type Config = typeof config;

