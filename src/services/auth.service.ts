import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { AppError } from "../lib/errors";
import { recordAuditLog } from "./audit.service";
import type { AuthUser } from "../types/context";
import { UserRoleType } from "@prisma/client";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  displayName: string;
  roles: UserRoleType[];
};

export class AuthService {
  // ── Password utilities ────────────────────────────────────────────────────────
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // ── JWT Access Tokens (15 min) ───────────────────────────────────────────────
  static generateAccessToken(user: {
    id: string;
    email: string;
    displayName: string;
    roles: UserRoleType[];
  }): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
    };
    return jwt.sign(payload, config.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
  }

  static verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, config.ACCESS_TOKEN_SECRET) as AccessTokenPayload;
    } catch {
      throw AppError.unauthorized("Invalid or expired access token");
    }
  }

  // ── Refresh Tokens (256-bit CSPRNG + SHA-256) ─────────────────────────────────
  static hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  }

  static generateRefreshToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  // ── Login ─────────────────────────────────────────────────────────────────────
  static async login(params: {
    email: string;
    password: string;
    ip?: string;
  }): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
    const { email, password, ip } = params;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        roles: true,
        classAssignments: true,
      },
    });

    // Check account lockout status
    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      await prisma.loginAttempt.create({
        data: { email: normalizedEmail, ip: ip || "unknown", succeeded: false },
      });
      throw AppError.locked();
    }

    const isPasswordValid = user ? await this.verifyPassword(password, user.passwordHash) : false;

    if (!user || !isPasswordValid) {
      if (user) {
        const nextFailedCount = user.failedLoginCount + 1;
        const lockedUntil =
          nextFailedCount >= 10 ? new Date(Date.now() + 30 * 60 * 1000) : null;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: nextFailedCount,
            lockedUntil,
          },
        });

        if (lockedUntil) {
          await recordAuditLog({
            userId: user.id,
            action: "auth.account_locked",
            entityType: "User",
            entityId: user.id,
            metadata: { failedAttempts: nextFailedCount, ip },
            ip,
          });
        }
      }

      await prisma.loginAttempt.create({
        data: { email: normalizedEmail, ip: ip || "unknown", succeeded: false },
      });

      throw AppError.unauthorized("Invalid email or password");
    }

    if (!user.isActive) {
      throw AppError.unauthorized("Account has been deactivated. Please contact the administrator.");
    }

    // Reset failed login counter on success
    if (user.failedLoginCount > 0 || user.lockedUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    await prisma.loginAttempt.create({
      data: { email: normalizedEmail, ip: ip || "unknown", succeeded: true },
    });

    // Generate tokens
    const familyId = crypto.randomUUID();
    const { rawToken, tokenHash } = this.generateRefreshToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        familyId,
        expiresAt,
      },
    });

    const userRoles = user.roles.map((r) => r.role);
    const assignedClasses = user.classAssignments.map((c) => c.classId);

    const accessToken = this.generateAccessToken({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: userRoles,
    });

    await recordAuditLog({
      userId: user.id,
      action: "auth.login_success",
      entityType: "User",
      entityId: user.id,
      ip,
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: userRoles,
      classes: assignedClasses,
    };

    return {
      user: authUser,
      accessToken,
      refreshToken: rawToken,
    };
  }

  // ── Refresh (with 30-second concurrency grace window) ─────────────────────────
  static async refresh(params: {
    rawRefreshToken: string;
    ip?: string;
  }): Promise<{
    accessToken: string;
    newRefreshToken?: string;
    isGraceWindow: boolean;
  }> {
    const { rawRefreshToken, ip } = params;
    const tokenHash = this.hashToken(rawRefreshToken);

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            roles: true,
            classAssignments: true,
          },
        },
      },
    });

    if (!tokenRecord) {
      throw AppError.unauthorized("Invalid refresh token");
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw AppError.unauthorized("Refresh token expired");
    }

    if (!tokenRecord.user.isActive) {
      throw AppError.unauthorized("User account deactivated");
    }

    const userRoles = tokenRecord.user.roles.map((r) => r.role);

    // ── Check if already revoked ───────────────────────────────────────────────
    if (tokenRecord.revokedAt !== null) {
      const elapsedMs = Date.now() - tokenRecord.revokedAt.getTime();

      // Grace period: within 30 seconds of rotation
      if (elapsedMs <= 30_000) {
        // Multi-tab concurrent refresh: issue fresh access token without re-rotating or revoking family
        const accessToken = this.generateAccessToken({
          id: tokenRecord.user.id,
          email: tokenRecord.user.email,
          displayName: tokenRecord.user.displayName,
          roles: userRoles,
        });

        return {
          accessToken,
          isGraceWindow: true,
        };
      }

      // OUTSIDE GRACE WINDOW: Detected reuse / token theft!
      console.warn(
        `🚨 Security Alert: Token reuse detected outside grace window (${Math.round(
          elapsedMs / 1000
        )}s elapsed). Revoking family ${tokenRecord.familyId}.`
      );

      // Invalidate the entire family tree
      await prisma.refreshToken.updateMany({
        where: { familyId: tokenRecord.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await recordAuditLog({
        userId: tokenRecord.userId,
        action: "auth.refresh_token_reuse_detected",
        entityType: "RefreshTokenFamily",
        entityId: tokenRecord.familyId,
        metadata: {
          revokedTokenId: tokenRecord.id,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          ip,
        },
        ip,
      });

      throw AppError.unauthorized("Session revoked due to token theft detection");
    }

    // ── Active Token Rotation ──────────────────────────────────────────────────
    const { rawToken: nextRawToken, tokenHash: nextTokenHash } = this.generateRefreshToken();
    const nextExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      // 1. Create successor token
      const nextToken = await tx.refreshToken.create({
        data: {
          userId: tokenRecord.userId,
          tokenHash: nextTokenHash,
          familyId: tokenRecord.familyId,
          expiresAt: nextExpiresAt,
        },
      });

      // 2. Mark current token revoked with replacedById pointer
      await tx.refreshToken.update({
        where: { id: tokenRecord.id },
        data: {
          revokedAt: new Date(),
          replacedById: nextToken.id,
        },
      });
    });

    const accessToken = this.generateAccessToken({
      id: tokenRecord.user.id,
      email: tokenRecord.user.email,
      displayName: tokenRecord.user.displayName,
      roles: userRoles,
    });

    return {
      accessToken,
      newRefreshToken: nextRawToken,
      isGraceWindow: false,
    };
  }

  // ── Logout ────────────────────────────────────────────────────────────────────
  static async logout(params: {
    rawRefreshToken?: string;
    userId?: string;
    ip?: string;
  }): Promise<void> {
    const { rawRefreshToken, userId, ip } = params;

    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (userId) {
      await recordAuditLog({
        userId,
        action: "auth.logout",
        entityType: "User",
        entityId: userId,
        ip,
      });
    }
  }

  // ── Get Current User Details ──────────────────────────────────────────────────
  static async getMe(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        classAssignments: true,
      },
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized("User account not found or inactive");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AppError.locked();
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map((r) => r.role),
      classes: user.classAssignments.map((c) => c.classId),
    };
  }

  // ── Password Reset Request ────────────────────────────────────────────────────
  static async forgotPassword(params: { email: string; ip?: string }): Promise<void> {
    const { email, ip } = params;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      // Return cleanly to prevent email enumeration
      return;
    }

    // Invalidate existing active reset tokens
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await recordAuditLog({
      userId: user.id,
      action: "auth.password_reset_requested",
      entityType: "User",
      entityId: user.id,
      ip,
    });

    if (config.NODE_ENV === "development") {
      console.log(
        `🔑 [DEV ONLY] Password reset requested for ${user.email}. Token: ${rawToken}`
      );
    }
  }

  // ── Reset Password With Token ─────────────────────────────────────────────────
  static async resetPassword(params: {
    token: string;
    newPassword: string;
    ip?: string;
  }): Promise<void> {
    const { token, newPassword, ip } = params;
    const tokenHash = this.hashToken(token);

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt !== null || resetToken.expiresAt < new Date()) {
      throw AppError.badRequest("Invalid, used, or expired password reset token");
    }

    const newPasswordHash = await this.hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      // 1. Update user password and unlock
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: newPasswordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      // 2. Mark reset token as used
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // 3. Revoke all existing refresh sessions for this user
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await recordAuditLog({
      userId: resetToken.userId,
      action: "auth.password_reset_completed",
      entityType: "User",
      entityId: resetToken.userId,
      ip,
    });
  }
}

