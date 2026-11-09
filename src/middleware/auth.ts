import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { AuthService } from "../services/auth.service";
import { AppError } from "../lib/errors";
import { UserRoleType } from "@prisma/client";
import type { AppEnv } from "../types/context";

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookieToken = getCookie(c, "durg_access");
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    throw AppError.unauthorized("Authentication required");
  }

  const payload = AuthService.verifyAccessToken(token);
  const user = await AuthService.getMe(payload.sub);

  c.set("user", user);
  await next();
};

export const requireRole = (...roles: UserRoleType[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      throw AppError.unauthorized("Authentication required");
    }

    const hasRole = user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      throw AppError.forbidden("Access denied: insufficient permissions");
    }

    await next();
  };
};

export const requireTeacher: MiddlewareHandler<AppEnv> = requireRole(
  UserRoleType.teacher,
  UserRoleType.admin
);

export const requireAdmin: MiddlewareHandler<AppEnv> = requireRole(UserRoleType.admin);

export const requireClassAccess = (
  paramName = "classId"
): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      throw AppError.unauthorized("Authentication required");
    }

    // Admins bypass class-level scoping
    if (user.roles.includes(UserRoleType.admin)) {
      return next();
    }

    const classId = c.req.param(paramName);
    if (!classId) {
      throw AppError.badRequest(`Missing required route parameter: ${paramName}`);
    }

    const hasAccess = user.classes.includes(classId);
    if (!hasAccess) {
      throw AppError.forbidden(
        `Access denied: You are not assigned to manage content for ${classId}`
      );
    }

    await next();
  };
};

