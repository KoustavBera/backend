import { describe, it, expect, beforeAll } from "bun:test";
import app from "../src/index";
import { prisma } from "../src/db/prisma";

describe("Phase 2: Authentication & Security Tests", () => {
  let adminAccessCookie = "";
  let adminRefreshCookie = "";
  let teacherAccessCookie = "";
  let teacherRefreshCookie = "";

  beforeAll(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }, 30000);

  it("1. Reject invalid credentials with 401", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@durgapurhighschool.in",
          password: "WrongPassword!",
        }),
      })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("2. Successfully login as Admin and receive dual cookies", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user.email).toBe("admin@durgapurhighschool.in");
    expect(body.data.user.roles).toContain("admin");

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(2);

    for (const cookie of setCookies) {
      if (cookie.startsWith("durg_access=")) {
        adminAccessCookie = cookie.split(";")[0];
      }
      if (cookie.startsWith("durg_refresh=")) {
        adminRefreshCookie = cookie.split(";")[0];
      }
    }

    expect(adminAccessCookie).toContain("durg_access=");
    expect(adminRefreshCookie).toContain("durg_refresh=");
  });

  it("3. Successfully login as Teacher and check assigned classes via /me", async () => {
    const loginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "anirban.banerjee@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );

    expect(loginRes.status).toBe(200);
    const setCookies = loginRes.headers.getSetCookie();
    for (const cookie of setCookies) {
      if (cookie.startsWith("durg_access=")) teacherAccessCookie = cookie.split(";")[0];
      if (cookie.startsWith("durg_refresh=")) teacherRefreshCookie = cookie.split(";")[0];
    }

    // Call GET /api/auth/me with teacher's access cookie
    const meRes = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: teacherAccessCookie },
      })
    );

    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.user.email).toBe("anirban.banerjee@durgapurhighschool.in");
    expect(meBody.data.user.roles).toContain("teacher");
    expect(meBody.data.user.classes).toContain("class-9");
    expect(meBody.data.user.classes).toContain("class-10");
  });

  it("4. Refresh token rotation & 30-second concurrency grace window", async () => {
    const rawOldRefresh = teacherRefreshCookie;

    // 1st Refresh: normal rotation
    const refresh1 = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: teacherRefreshCookie },
      })
    );
    expect(refresh1.status).toBe(200);

    let nextRefreshCookie = "";
    for (const cookie of refresh1.headers.getSetCookie()) {
      if (cookie.startsWith("durg_refresh=")) {
        nextRefreshCookie = cookie.split(";")[0];
      }
    }
    expect(nextRefreshCookie).toBeDefined();

    // 2nd Refresh: Simulate concurrent tab sending old refresh token within 30s
    const refreshConcurrent = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: rawOldRefresh },
      })
    );
    expect(refreshConcurrent.status).toBe(200);
    const concurrentBody = await refreshConcurrent.json();
    expect(concurrentBody.data.ok).toBe(true);
  });

  it("5. Detect token theft when reused outside 30s grace window", async () => {
    // Manually age the revoked token in DB past 30 seconds
    const oldTokenValue = teacherRefreshCookie.replace("durg_refresh=", "");
    const crypto = await import("crypto");
    const oldHash = crypto.createHash("sha256").update(oldTokenValue).digest("hex");

    await prisma.refreshToken.updateMany({
      where: { tokenHash: oldHash },
      data: {
        revokedAt: new Date(Date.now() - 60_000), // 60 seconds ago
      },
    });

    // Replay attack with expired-grace token
    const theftAttempt = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: teacherRefreshCookie },
      })
    );

    expect(theftAttempt.status).toBe(401);
    const theftBody = await theftAttempt.json();
    expect(theftBody.error.message).toContain("theft");
  });

  it("6. Logout revokes the session and clears cookies", async () => {
    const logoutRes = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: adminRefreshCookie },
      })
    );

    expect(logoutRes.status).toBe(200);
    const cookies = logoutRes.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("durg_access=;"))).toBe(true);
    expect(cookies.some((c) => c.includes("durg_refresh=;"))).toBe(true);
  });
});
