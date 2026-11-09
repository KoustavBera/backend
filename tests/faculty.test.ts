import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../src/index.js";
import { prisma } from "../src/db/prisma.js";

describe("Dynamic Faculty / Staff Directory API", () => {
  let adminCookie = "";
  let teacherCookie = "";
  let createdFacultyId = "";
  const testSlug = `swagata-ghosh-${Date.now()}`;

  afterAll(async () => {
    try {
      await prisma.facultyMember.deleteMany({
        where: { slug: { startsWith: "swagata-ghosh" } },
      });
    } catch {
      // ignore
    }
  });

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

    // 2. Login as Teacher (non-admin)
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

  it("1. GET /api/faculty returns active faculty with Cache-Control headers", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/faculty"));
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=60");

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);

    const first = body.data[0];
    expect(first.name).toBeDefined();
    expect(first.designation).toBeDefined();
    expect(first.education).toBeDefined();
    expect(first.image).toBeDefined();
    expect(first.image.length).toBeGreaterThan(0);
  }, 20000);

  it("2. GET /api/faculty?dept=Science filters faculty by department", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/faculty?dept=Science"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    for (const f of body.data) {
      expect(f.department).toBe("Science");
    }
  }, 20000);

  it("3. GET /api/faculty/:id retrieves single faculty member by slug", async () => {
    const res = await app.fetch(
      new Request("http://localhost:5000/api/faculty/amitabh-sengupta")
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.slug).toBe("amitabh-sengupta");
    expect(body.data.name).toBe("Dr. Amitabh Sengupta");
    expect(body.data.designation).toBe("Headmaster");
    expect(body.data.image).toBeDefined();
  }, 20000);

  it("4. Non-admin users are blocked from admin endpoints", async () => {
    // 4.1 Unauthenticated POST
    const anonRes = await app.fetch(
      new Request("http://localhost:5000/api/faculty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Teacher",
          designation: "Assistant Teacher",
          education: "M.Sc., B.Ed.",
        }),
      })
    );
    expect(anonRes.status).toBe(401);

    // 4.2 Teacher (non-admin) POST
    const teacherPostRes = await app.fetch(
      new Request("http://localhost:5000/api/faculty", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          name: "Teacher Attempt",
          designation: "Assistant Teacher",
          education: "M.A., B.Ed.",
        }),
      })
    );
    expect(teacherPostRes.status).toBe(403);

    // 4.3 Teacher (non-admin) photo upload url
    const teacherUploadRes = await app.fetch(
      new Request("http://localhost:5000/api/faculty/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          filename: "test.jpg",
          contentType: "image/jpeg",
          sizeBytes: 1024,
        }),
      })
    );
    expect(teacherUploadRes.status).toBe(403);
  }, 20000);

  it("5. Admin can generate photo upload URL", async () => {
    const res = await app.fetch(
      new Request("http://localhost:5000/api/faculty/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          filename: "teacher-photo.png",
          contentType: "image/png",
          sizeBytes: 204800,
        }),
      })
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.uploadUrl).toBeDefined();
    expect(body.data.uploadIntentId).toBeDefined();
    expect(body.data.objectKey).toContain("faculty/");
  }, 20000);

  it("6. Admin can create a new faculty member", async () => {
    const res = await app.fetch(
      new Request("http://localhost:5000/api/faculty", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          name: "Smt. Swagata Ghosh",
          nameBn: "শ্রীমতী স্বাগতা ঘোষ",
          slug: testSlug,
          designation: "Assistant Teacher (Economics)",
          designationBn: "সহকারী শিক্ষিকা (অর্থনীতি)",
          department: "Commerce & Economics",
          education: "M.Sc. (Economics), B.Ed.",
          educationBn: "এম.এসসি. (অর্থনীতি), বি.এড.",
          description: "Specialized in microeconomics and economic statistics.",
          sortOrder: 25,
          isActive: true,
        }),
      })
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.slug).toBe(testSlug);
    expect(body.data.name).toBe("Smt. Swagata Ghosh");
    expect(body.data.department).toBe("Commerce & Economics");
    expect(body.data.image).toBeDefined(); // Fallback avatar resolved

    createdFacultyId = body.data.id;
  }, 20000);

  it("7. Admin can update an existing faculty member", async () => {
    expect(createdFacultyId).toBeDefined();

    const res = await app.fetch(
      new Request(`http://localhost:5000/api/faculty/${createdFacultyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          designation: "Senior Assistant Teacher (Economics)",
          sortOrder: 15,
        }),
      })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.designation).toBe("Senior Assistant Teacher (Economics)");
    expect(body.data.sortOrder).toBe(15);
  }, 20000);

  it("8. Admin can delete a faculty member", async () => {
    expect(createdFacultyId).toBeDefined();

    const res = await app.fetch(
      new Request(`http://localhost:5000/api/faculty/${createdFacultyId}`, {
        method: "DELETE",
        headers: {
          Cookie: adminCookie,
        },
      })
    );
    expect(res.status).toBe(200);

    // Verify it is no longer returned
    const getRes = await app.fetch(
      new Request(`http://localhost:5000/api/faculty/${createdFacultyId}`)
    );
    expect(getRes.status).toBe(404);
  }, 20000);
});
