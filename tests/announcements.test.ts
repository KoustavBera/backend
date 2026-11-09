import { describe, it, expect, beforeAll } from "bun:test";
import app from "../src/index.js";
import { prisma } from "../src/db/prisma.js";

describe("Dynamic Urgent Announcements API", () => {
  let adminCookie = "";
  let teacherCookie = "";
  let createdAnnouncementId = "";

  beforeAll(async () => {
    // Retry loop to safely absorb Neon serverless wakeups
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // 1. Login as Admin
    const adminRes = await app.fetch(
      new Request("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of adminRes.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) adminCookie = c.split(";")[0];
    }

    // 2. Login as Teacher
    const teacherRes = await app.fetch(
      new Request("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "anirban.banerjee@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of teacherRes.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) teacherCookie = c.split(";")[0];
    }
  }, 30000);

  it("1. GET /api/announcements returns active announcements with Cache-Control", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/announcements"));
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=60");

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);

    const first = json.data[0];
    expect(first.id).toBeDefined();
    expect(first.textEn).toBeDefined();
    expect(first.text).toBeDefined();
    expect(first.severity).toBeDefined();
    expect(first.isActive).toBe(true);
  });

  it("2. GET /api/announcements?lang=bn returns Bengali localized text", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/announcements?lang=bn"));
    expect(res.status).toBe(200);

    const json = await res.json();
    const itemWithBn = json.data.find((a: any) => a.textBn);
    expect(itemWithBn).toBeDefined();
    expect(itemWithBn.text).toBe(itemWithBn.textBn);
  });

  it("3. Protected: Non-admin or unauthenticated cannot access admin endpoints", async () => {
    // Unauthenticated
    const anonRes = await app.fetch(new Request("http://localhost:5000/api/announcements/admin"));
    expect(anonRes.status).toBe(401);

    // Teacher (forbidden)
    const teacherRes = await app.fetch(
      new Request("http://localhost:5000/api/announcements/admin", {
        headers: { Cookie: teacherCookie },
      })
    );
    expect(teacherRes.status).toBe(403);
  });

  it("4. Admin creates an announcement and verifies it is public", async () => {
    const createRes = await app.fetch(
      new Request("http://localhost:5000/api/announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          textEn: "Urgent: Severe weather warning — School closes at 1:00 PM today.",
          textBn: "জরুরী: প্রতিকূল আবহাওয়ার সতর্কতা — আজ দুপুর ১:০০ টায় স্কুল ছুটি হবে।",
          severity: "urgent",
          link: "/news",
          sortOrder: 0,
          isActive: true,
        }),
      })
    );

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.data.id).toBeDefined();
    expect(createJson.data.severity).toBe("urgent");
    createdAnnouncementId = createJson.data.id;

    // Verify it appears at the top of public active announcements
    const publicRes = await app.fetch(new Request("http://localhost:5000/api/announcements"));
    const publicJson = await publicRes.json();
    const foundInPublic = publicJson.data.some((a: any) => a.id === createdAnnouncementId);
    expect(foundInPublic).toBe(true);
  });

  it("5. Admin updates the announcement", async () => {
    const updateRes = await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${createdAnnouncementId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          textEn: "Updated: School reopens normally tomorrow morning.",
          severity: "warning",
        }),
      })
    );
    expect(updateRes.status).toBe(200);
    const updateJson = await updateRes.json();
    expect(updateJson.data.textEn).toBe("Updated: School reopens normally tomorrow morning.");
    expect(updateJson.data.severity).toBe("warning");
  });

  it("6. Admin toggles active/inactive status and verifies exclusion", async () => {
    const toggleRes = await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${createdAnnouncementId}/toggle`, {
        method: "PATCH",
        headers: { Cookie: adminCookie },
      })
    );
    expect(toggleRes.status).toBe(200);
    const toggleJson = await toggleRes.json();
    expect(toggleJson.data.isActive).toBe(false);

    // Verify inactive announcement is NOT returned in public API
    const publicAfterToggleRes = await app.fetch(
      new Request("http://localhost:5000/api/announcements")
    );
    const publicAfterToggleJson = await publicAfterToggleRes.json();
    const foundAfterToggle = publicAfterToggleJson.data.some(
      (a: any) => a.id === createdAnnouncementId
    );
    expect(foundAfterToggle).toBe(false);
  });

  it("7. Admin deletes announcement and verifies 404", async () => {
    const deleteRes = await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${createdAnnouncementId}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      })
    );
    expect(deleteRes.status).toBe(200);

    const getRes = await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${createdAnnouncementId}`, {
        headers: { Cookie: adminCookie },
      })
    );
    expect(getRes.status).toBe(404);
  });

  it("8. Expired and future-scheduled announcements are excluded from public API", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Create expired announcement
    const expiredRes = await app.fetch(
      new Request("http://localhost:5000/api/announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          textEn: "Old expired event notice",
          isActive: true,
          startDate: twoDaysAgo,
          endDate: yesterday,
        }),
      })
    );
    const expiredId = (await expiredRes.json()).data.id;

    // Create future scheduled announcement
    const futureRes = await app.fetch(
      new Request("http://localhost:5000/api/announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          textEn: "Future announcement not yet active",
          isActive: true,
          startDate: tomorrow,
          endDate: nextWeek,
        }),
      })
    );
    const futureId = (await futureRes.json()).data.id;

    // Check public listing
    const publicRes = await app.fetch(new Request("http://localhost:5000/api/announcements"));
    const publicJson = await publicRes.json();

    const hasExpired = publicJson.data.some((a: any) => a.id === expiredId);
    const hasFuture = publicJson.data.some((a: any) => a.id === futureId);

    expect(hasExpired).toBe(false);
    expect(hasFuture).toBe(false);

    // Clean up
    await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${expiredId}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      })
    );
    await app.fetch(
      new Request(`http://localhost:5000/api/announcements/${futureId}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      })
    );
  });
});
