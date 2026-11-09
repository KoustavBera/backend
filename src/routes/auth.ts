import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "../config";
import { AuthService } from "../services/auth.service";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types/context";

const auth = new Hono<AppEnv>();

// ── Cookie Helpers ────────────────────────────────────────────────────────────
function setAuthCookies(
  c: Context<AppEnv>,
  tokens: { accessToken: string; refreshToken?: string }
) {
  const isProd = config.NODE_ENV === "production";
  const domain = config.COOKIE_DOMAIN || undefined;

  // durg_access: 15 min expiry, accessible across entire site
  setCookie(c, "durg_access", tokens.accessToken, {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "Strict",
    maxAge: 15 * 60, // 15 minutes
    domain,
  });

  // durg_refresh: 7 days expiry, restricted strictly to /api/auth path
  if (tokens.refreshToken) {
    setCookie(c, "durg_refresh", tokens.refreshToken, {
      path: "/api/auth",
      httpOnly: true,
      secure: isProd,
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      domain,
    });
  }
}

function clearAuthCookies(c: Context<AppEnv>) {
  const domain = config.COOKIE_DOMAIN || undefined;
  deleteCookie(c, "durg_access", { path: "/", domain });
  deleteCookie(c, "durg_refresh", { path: "/api/auth", domain });
}

// ── Request Schemas ───────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters long"),
});

// ── 1. POST /api/auth/login ───────────────────────────────────────────────────
auth.post(
  "/login",
  rateLimit({
    windowSeconds: 15 * 60, // 15 mins
    maxRequests: 10,
    prefix: "auth_login",
    failClosed: true,
  }),
  async (c) => {
    const body = await c.req.json();
    const validated = loginSchema.parse(body);

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";

    const { user, accessToken, refreshToken } = await AuthService.login({
      email: validated.email,
      password: validated.password,
      ip,
    });

    setAuthCookies(c, { accessToken, refreshToken });

    return c.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roles: user.roles,
        },
      },
    });
  }
);

// ── 2. POST /api/auth/refresh ──────────────────────────────────────────────────
auth.post(
  "/refresh",
  rateLimit({
    windowSeconds: 60,
    maxRequests: 30,
    prefix: "auth_refresh",
  }),
  async (c) => {
    const rawRefreshToken = getCookie(c, "durg_refresh");

    if (!rawRefreshToken) {
      throw AppError.unauthorized("Missing refresh token");
    }

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";

    try {
      const result = await AuthService.refresh({
        rawRefreshToken,
        ip,
      });

      // Set new access token cookie
      // In grace window, successor refresh token already exists in client cookie jar
      setAuthCookies(c, {
        accessToken: result.accessToken,
        refreshToken: result.newRefreshToken,
      });

      return c.json({ data: { ok: true } });
    } catch (err) {
      // Clear compromised/invalid cookies
      clearAuthCookies(c);
      throw err;
    }
  }
);

// ── 3. POST /api/auth/logout ───────────────────────────────────────────────────
auth.post("/logout", async (c) => {
  const rawRefreshToken = getCookie(c, "durg_refresh");
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";

  await AuthService.logout({
    rawRefreshToken,
    ip,
  });

  clearAuthCookies(c);

  return c.json({ data: { ok: true } });
});

// ── 4. GET /api/auth/me ───────────────────────────────────────────────────────
auth.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({
    data: {
      user: {
        id: user!.id,
        email: user!.email,
        displayName: user!.displayName,
        roles: user!.roles,
        classes: user!.classes,
      },
    },
  });
});

// ── 5. POST /api/auth/forgot-password ──────────────────────────────────────────
auth.post(
  "/forgot-password",
  rateLimit({
    windowSeconds: 60 * 60, // 1 hour
    maxRequests: 5,
    prefix: "auth_forgot_pwd",
  }),
  async (c) => {
    const body = await c.req.json();
    const validated = forgotPasswordSchema.parse(body);

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";

    await AuthService.forgotPassword({
      email: validated.email,
      ip,
    });

    // Always return 200 OK to prevent account enumeration
    return c.json({ data: { ok: true } });
  }
);

// ── 6. POST /api/auth/reset-password ───────────────────────────────────────────
auth.post(
  "/reset-password",
  rateLimit({
    windowSeconds: 60 * 60, // 1 hour
    maxRequests: 5,
    prefix: "auth_reset_pwd",
  }),
  async (c) => {
    const body = await c.req.json();
    const validated = resetPasswordSchema.parse(body);

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";

    await AuthService.resetPassword({
      token: validated.token,
      newPassword: validated.newPassword,
      ip,
    });

    clearAuthCookies(c);

    return c.json({ data: { ok: true } });
  }
);

export { auth };

